// @vitest-environment jsdom

import React, { act, isValidElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomerWorkspace: vi.fn()
}));

vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true");

vi.mock("../../lib/customerWorkspace", async () => ({
  ...(await vi.importActual("../../lib/customerWorkspace")),
  getCustomerWorkspace: mocks.getCustomerWorkspace
}));

vi.mock("../CustomerRevenueOpportunities", () => ({
  default: () => null,
  buildCustomerRevenueOpportunityRead: () => ({ state: "empty", opportunities: [] })
}));

vi.mock("../CustomerCommercialMeasures", () => ({ default: () => null }));
vi.mock("../CustomerCommercialTimeline", () => ({ default: () => null }));
vi.mock("../QuoteVersionComparison", () => ({ default: () => null }));
vi.mock("../RevenueAutopilotCustomerControls", () => ({ default: () => null }));

const { CustomerDirectoryPresentation } = await import("../CustomerDirectoryView");
const {
  default: CustomerWorkspaceView,
  CustomerEventsHeader,
  CustomerRelationshipBriefing,
  CustomerWorkspacePartialNotice,
  CustomerWorkspaceReadState,
  resolveCustomerWorkspaceTabKey
} = await import("../CustomerWorkspaceView");
const {
  GuardedWorkspaceNavigationProvider: WorkspaceNavigationProvider,
  useWorkspaceNavigation
} = await import("../../context/WorkspaceNavigationContext");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const READY_DIRECTORY = {
  loading: false,
  error: "",
  source: "firebase",
  items: [],
  nextCursor: ""
};

function directoryMarkup(state) {
  return renderToStaticMarkup(
    <CustomerDirectoryPresentation
      state={state}
      searchDraft=""
      cursorHistoryLength={0}
      onSearchDraftChange={() => {}}
      onApplySearch={() => {}}
      onClear={() => {}}
      onRefresh={() => {}}
      onOpenCustomer={() => {}}
      onNewQuote={() => {}}
      onPreviousPage={() => {}}
      onNextPage={() => {}}
    />
  );
}

function elementText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  return elementText(node.props.children);
}

function findElement(node, predicate) {
  if (isValidElement(node) && predicate(node)) return node;
  if (!isValidElement(node)) return null;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function customerReturnWorkspace({ includeOpportunity = true } = {}) {
  const opportunity = {
    id: "quote-exact",
    organizationId: "org-one",
    customerId: "customer-one",
    quoteNumber: "Q-EXACT",
    status: "draft",
    createdAtISO: "2026-08-20T14:00:00.000Z",
    updatedAtISO: "2026-08-21T15:00:00.000Z",
    event: {
      name: "Exact client dinner",
      date: "2026-10-12"
    }
  };
  const quotes = includeOpportunity ? [opportunity] : [];
  return {
    organizationId: "org-one",
    source: "firebase",
    customer: {
      id: "customer-one",
      customerId: "customer-one",
      organizationId: "org-one",
      name: "Henderson Events",
      email: "events@henderson.example"
    },
    quotes,
    activeQuotes: quotes,
    proposalVersions: [],
    events: [],
    money: [],
    conversations: [],
    recentActivity: [],
    attention: { itemCount: 0, items: [] },
    nextAction: { kind: "none", label: "No immediate staff action" },
    briefing: {
      activeQuoteCount: quotes.length,
      displayedQuoteCount: quotes.length,
      attentionCount: 0,
      nextEvent: null,
      latestActivity: null,
      nextAction: { kind: "none", label: "No immediate staff action" },
      scope: { limit: 25, truncated: false }
    },
    quotePageInfo: { limit: 25, truncated: false },
    versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] }
  };
}

function createStackWindow(initialPath = "/app/customers/customer-one") {
  const origin = "https://quotepilot.test";
  const listeners = new Map();
  const location = { origin, pathname: "/", search: "", hash: "" };
  const entries = [];
  let index = 0;
  const applyPath = (path) => {
    const url = new URL(path, origin);
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  };
  const dispatch = (type) => {
    const event = new windowObject.Event(type);
    for (const listener of listeners.get(type) || []) listener(event);
  };
  const initialUrl = new URL(initialPath, origin);
  entries.push({ path: `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`, state: null });
  applyPath(entries[0].path);
  const history = {
    scrollRestoration: "auto",
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _title, path) {
      entries.splice(index + 1);
      entries.push({ path, state });
      index = entries.length - 1;
      applyPath(path);
    },
    replaceState(state, _title, path) {
      entries[index] = { path, state };
      applyPath(path);
    },
    go(delta) {
      const target = index + Number(delta || 0);
      if (target < 0 || target >= entries.length || target === index) return;
      index = target;
      applyPath(entries[index].path);
      dispatch("popstate");
    },
    back() { history.go(-1); },
    forward() { history.go(1); }
  };
  const windowObject = {
    Event: class FakeEvent {
      constructor(type) { this.type = type; }
    },
    location,
    history,
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(listener);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      dispatch(event.type);
      return true;
    }
  };
  return windowObject;
}

function CustomerReturnJourney({ onNavigation, onWriteAttempt }) {
  const navigation = useWorkspaceNavigation();
  onNavigation(navigation);
  useEffect(() => {
    navigation.setReturnContextScope({
      organizationId: "org-one",
      principalId: "admin-one",
      role: "admin"
    });
  }, [navigation.setReturnContextScope]);

  const status = (
    <output data-return-status={navigation.returnContextStatus?.state || ""}>
      {navigation.returnContextStatus?.message || ""}
    </output>
  );
  if (navigation.route.routeId === "customer-detail") {
    return (
      <>
        <CustomerWorkspaceView
          organizationId="org-one"
          organizationName="Northstar Catering"
          customerId="customer-one"
          ambientMode
          currentUserRole="admin"
          onCreateRebook={onWriteAttempt}
          onOpenQuoteEdit={onWriteAttempt}
          onOpenOpportunity={(target) => navigation.navigate(`/app/quotes/${target.quoteId}`, {
            preserveSearch: false,
            preserveReturnContext: true,
            returnContextSurfaceId: "living-opportunity",
            returnContextHint: {
              focus: {
                kind: "client-overview-action",
                objectId: target.quoteId,
                actionId: target.actionId,
                controlId: target.returnFocusControlId
              }
            }
          })}
        />
        {status}
      </>
    );
  }
  if (navigation.route.routeId === "quote-detail") {
    return (
      <main>
        <button
          type="button"
          data-return-to-client
          onClick={() => navigation.returnToOrigin({ fallback: "/app/customers/customer-one" })}
        >
          Return to client
        </button>
        {status}
      </main>
    );
  }
  return <main>{status}</main>;
}

let integrationContainer = null;
let integrationRoot = null;
let animationFrames = null;
let nextAnimationFrameId = 0;
let originalRequestAnimationFrame;
let originalCancelAnimationFrame;
let originalScrollTo;

beforeEach(() => {
  mocks.getCustomerWorkspace.mockReset().mockResolvedValue(customerReturnWorkspace());
  animationFrames = new Map();
  nextAnimationFrameId = 0;
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  originalScrollTo = window.scrollTo;
  window.requestAnimationFrame = (callback) => {
    nextAnimationFrameId += 1;
    animationFrames.set(nextAnimationFrameId, callback);
    return nextAnimationFrameId;
  };
  window.cancelAnimationFrame = (frameId) => animationFrames.delete(frameId);
  window.scrollTo = vi.fn();
});

afterEach(() => {
  if (integrationRoot) act(() => integrationRoot.unmount());
  integrationContainer?.remove();
  integrationContainer = null;
  integrationRoot = null;
  animationFrames?.clear();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  window.scrollTo = originalScrollTo;
});

async function flushAnimationFrames(limit = 80) {
  let idlePasses = 0;
  for (let index = 0; index < limit; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    if (!animationFrames.size) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      idlePasses += 1;
      if (idlePasses >= 3 && !animationFrames.size) return;
      continue;
    }
    idlePasses = 0;
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      callbacks.forEach((callback) => callback(Date.now()));
      await Promise.resolve();
    });
  }
}

async function mountCustomerReturnJourney({ onWriteAttempt }) {
  const windowObject = createStackWindow();
  let navigation = null;
  integrationContainer = document.createElement("div");
  document.body.appendChild(integrationContainer);
  integrationRoot = createRoot(integrationContainer);
  await act(async () => {
    integrationRoot.render(
      <WorkspaceNavigationProvider windowObject={windowObject} preserveSearch={false}>
        <CustomerReturnJourney
          onNavigation={(value) => { navigation = value; }}
          onWriteAttempt={onWriteAttempt}
        />
      </WorkspaceNavigationProvider>
    );
    await Promise.resolve();
  });
  await flushAnimationFrames();
  return { navigation: () => navigation, windowObject };
}

async function waitForSelector(selector, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const target = integrationContainer?.querySelector(selector);
    if (target) return target;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
    await flushAnimationFrames(8);
  }
  return null;
}

async function openExactOpportunityFromClient() {
  const disclosure = integrationContainer.querySelector(".ambient-client-overview__record");
  expect(disclosure).not.toBeNull();
  act(() => {
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
  });
  const quotesTab = integrationContainer.querySelector("#customer-tab-quotes");
  expect(quotesTab).not.toBeNull();
  act(() => quotesTab.click());
  const action = await waitForSelector(
    '[data-opportunity-id="quote-exact"] [data-ambient-action-id="review-client-opportunity:quote-exact"]'
  );
  expect(action).not.toBeNull();
  await act(async () => {
    action.focus();
    action.click();
    await Promise.resolve();
  });
  return action;
}

describe("customer workspace executable presentation states", () => {
  test("renders the customer directory loading state before results resolve", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      loading: true,
      source: ""
    });

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain("Loading customers...");
    expect(markup).not.toContain("No customers match this directory view.");
    expect(markup).not.toContain("<table");
  });

  test("renders the customer directory empty state after a completed read", () => {
    const markup = directoryMarkup(READY_DIRECTORY);

    expect(markup).toContain("Source: Firestore staff records");
    expect(markup).toContain('data-capability-state="empty"');
    expect(markup).toContain("No customers match this directory view.");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("<table");
  });

  test("renders the customer directory success state with customer actions", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      items: [{
        id: "customer-opaque-1",
        name: "Ada Lovelace",
        company: "Analytical Events",
        email: "ada@example.test",
        phone: "555-0101",
        lastQuoteNumber: "Q-1001",
        lastEventName: "Launch dinner",
        lastEventDate: "2026-09-01"
      }]
    });

    expect(markup).toContain("<table");
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Customer directory results"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Q-1001");
    expect(markup).toContain("Open 360");
    expect(markup).not.toContain("No customers match this directory view.");
  });

  test("renders the Customer 360 partial state with its bounded-read limit", () => {
    const markup = renderToStaticMarkup(
      <CustomerWorkspacePartialNotice
        quotePageInfo={{ truncated: true, limit: 25 }}
        onOpenQuotes={() => {}}
      />
    );
    const completeMarkup = renderToStaticMarkup(
      <CustomerWorkspacePartialNotice
        quotePageInfo={{ truncated: false, limit: 25 }}
        onOpenQuotes={() => {}}
      />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("shows up to 25 linked quotes");
    expect(markup).toContain("counts and amounts below may be incomplete");
    expect(markup).toContain("Open complete Quotes history");
    expect(completeMarkup).toBe("");
  });

  test("renders the customer directory error state without claiming empty results", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory is temporarily unavailable."
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain("Customer directory is temporarily unavailable.");
    expect(markup).not.toContain("No customers match this directory view.");
    expect(markup).not.toContain("<table");
  });

  test("retains a completed customer directory page with explicit stale read context", () => {
    const markup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory refresh failed.",
      stale: true,
      loadedAt: Date.parse("2026-08-09T12:00:00.000Z"),
      items: [{
        id: "customer-opaque-1",
        name: "Ada Lovelace",
        email: "ada@example.test"
      }]
    });

    expect(markup).toContain('data-capability-state="stale"');
    expect(markup).toContain("Customer directory read context");
    expect(markup).toContain("prior completed page remains visible");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).not.toContain("No customers match this directory view.");
  });

  test("renders the bounded Customer 360 relationship briefing and exact next action", () => {
    const markup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 2,
          displayedQuoteCount: 25,
          attentionCount: 1,
          nextEvent: {
            quoteId: "quote-2",
            eventName: "Board dinner",
            date: "2026-09-01"
          },
          latestActivity: {
            quoteId: "quote-1",
            label: "Proposal accepted",
            atISO: "2026-08-08T10:00:00.000Z"
          },
          nextAction: {
            kind: "workflow",
            label: "Review the customer change request",
            quoteId: "quote-1",
            attentionType: "change_request"
          },
          scope: { limit: 25, truncated: true }
        }}
        onOpenQuote={() => {}}
        onOpenWorkflow={() => {}}
      />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain("What matters next");
    expect(markup).toContain("older linked quotes exist");
    expect(markup).toContain("Board dinner");
    expect(markup).toContain("Proposal accepted");
    expect(markup).toContain("Open in Workflow");
  });

  test("qualifies missing briefing milestones when the customer read is truncated", () => {
    const boundedMarkup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 0,
          displayedQuoteCount: 25,
          attentionCount: 0,
          scope: { truncated: true }
        }}
      />
    );
    const completeMarkup = renderToStaticMarkup(
      <CustomerRelationshipBriefing
        briefing={{
          activeQuoteCount: 0,
          displayedQuoteCount: 0,
          attentionCount: 0,
          scope: { truncated: false }
        }}
      />
    );

    expect(boundedMarkup).toContain("No dated event in this bounded view");
    expect(boundedMarkup).toContain("No activity in this bounded view");
    expect(completeMarkup).toContain("No dated event recorded");
    expect(completeMarkup).toContain("No activity recorded");
  });

  test("exposes loading, error recovery, and completed-empty Customer 360 states with read context", () => {
    const retry = vi.fn();
    const loadingMarkup = renderToStaticMarkup(
      <CustomerWorkspaceReadState
        state="loading"
        organizationId="org-1"
        organizationName="Test Org"
      />
    );
    const errorTree = CustomerWorkspaceReadState({
      state: "error",
      organizationId: "org-1",
      organizationName: "Test Org",
      errorMessage: "Tenant read failed.",
      onRetry: retry
    });
    const errorMarkup = renderToStaticMarkup(errorTree);
    const retryButton = findElement(errorTree, (element) => (
      element.type === "button" && elementText(element) === "Retry"
    ));
    const emptyMarkup = renderToStaticMarkup(
      <CustomerWorkspaceReadState
        state="empty"
        organizationId="org-1"
        organizationName="Test Org"
        loadedAt={Date.parse("2026-08-09T12:00:00.000Z")}
      />
    );

    expect(loadingMarkup).toContain('data-capability-state="loading"');
    expect(loadingMarkup).toContain("Client overview details");
    expect(errorMarkup).toContain('data-capability-state="error"');
    expect(errorMarkup).toContain('data-capability-state="recovery"');
    expect(errorMarkup).toContain("Tenant read failed.");
    retryButton.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
    expect(emptyMarkup).toContain('data-capability-state="empty"');
    expect(emptyMarkup).toContain("Customer not found");
    expect(emptyMarkup).toContain("bounded tenant-scoped read completed");
  });

  test("maps Customer 360 tabs with wraparound keyboard behavior", () => {
    expect(resolveCustomerWorkspaceTabKey("overview", "ArrowRight")).toBe("quotes");
    expect(resolveCustomerWorkspaceTabKey("overview", "ArrowLeft")).toBe("conversations");
    expect(resolveCustomerWorkspaceTabKey("events", "Home")).toBe("overview");
    expect(resolveCustomerWorkspaceTabKey("events", "End")).toBe("conversations");
    expect(resolveCustomerWorkspaceTabKey("events", "Enter")).toBe("events");
  });

  test("does not offer a Schedule route when the feature is unavailable", () => {
    const disabledMarkup = renderToStaticMarkup(<CustomerEventsHeader scheduleAvailable={false} />);
    const enabledMarkup = renderToStaticMarkup(<CustomerEventsHeader scheduleAvailable onOpenSchedule={() => {}} />);

    expect(disabledMarkup).toContain("Schedule is not enabled for this organization.");
    expect(disabledMarkup).not.toContain("Open Schedule");
    expect(enabledMarkup).toContain("Open Schedule");
  });

  test("executes the customer directory recovery control after an error", () => {
    const onRefresh = vi.fn();
    const errorMarkup = directoryMarkup({
      ...READY_DIRECTORY,
      error: "Customer directory is temporarily unavailable."
    });
    const tree = CustomerDirectoryPresentation({
      state: {
        ...READY_DIRECTORY,
        error: "Customer directory is temporarily unavailable."
      },
      searchDraft: "",
      cursorHistoryLength: 0,
      onRefresh
    });
    const refreshButton = findElement(tree, (element) => (
      element.type === "button" && elementText(element) === "Refresh"
    ));

    expect(refreshButton).not.toBeNull();
    expect(errorMarkup).toContain('data-capability-state="recovery"');
    expect(directoryMarkup(READY_DIRECTORY)).not.toContain(
      'data-capability-state=' + '"recovery"'
    );
    expect(refreshButton.props["data-capability-state"]).toBe("recovery");
    refreshButton.props.onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  test("captures and restores the exact Client 360 tab, record disclosure, and opportunity action through native history", async () => {
    const writeAttempt = vi.fn();
    const workspace = customerReturnWorkspace();
    const workspaceBefore = JSON.stringify(workspace);
    mocks.getCustomerWorkspace.mockResolvedValue(workspace);
    const { windowObject } = await mountCustomerReturnJourney({ onWriteAttempt: writeAttempt });

    await openExactOpportunityFromClient();

    expect(windowObject.location.pathname).toBe("/app/quotes/quote-exact");
    expect(windowObject.history.length).toBe(2);
    const returnButton = integrationContainer.querySelector("[data-return-to-client]");
    expect(returnButton).not.toBeNull();
    await act(async () => {
      returnButton.click();
      await Promise.resolve();
    });
    await flushAnimationFrames();

    const restoredDisclosure = integrationContainer.querySelector(".ambient-client-overview__record");
    const restoredTab = integrationContainer.querySelector("#customer-tab-quotes");
    const restoredAction = integrationContainer.querySelector(
      '[data-opportunity-id="quote-exact"] [data-ambient-action-id="review-client-opportunity:quote-exact"]'
    );
    expect(windowObject.location.pathname).toBe("/app/customers/customer-one");
    expect(windowObject.history.length).toBe(2);
    expect(restoredDisclosure?.open).toBe(true);
    expect(restoredTab?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(restoredAction);
    expect(integrationContainer.querySelector("[data-return-status]")?.dataset.returnStatus)
      .toBe("restored");
    expect(mocks.getCustomerWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.getCustomerWorkspace).toHaveBeenNthCalledWith(2, {
      organizationId: "org-one",
      customerId: "customer-one"
    });
    expect(writeAttempt).not.toHaveBeenCalled();
    expect(JSON.stringify(workspace)).toBe(workspaceBefore);
  });

  test("recovers at the exact Client 360 heading when the captured opportunity action is unavailable", async () => {
    const writeAttempt = vi.fn();
    const { windowObject } = await mountCustomerReturnJourney({ onWriteAttempt: writeAttempt });

    await openExactOpportunityFromClient();
    mocks.getCustomerWorkspace.mockResolvedValue(customerReturnWorkspace({ includeOpportunity: false }));
    const returnButton = integrationContainer.querySelector("[data-return-to-client]");
    expect(returnButton).not.toBeNull();
    await act(async () => {
      returnButton.click();
      await Promise.resolve();
    });
    await flushAnimationFrames();

    const restoredDisclosure = integrationContainer.querySelector(".ambient-client-overview__record");
    const restoredTab = integrationContainer.querySelector("#customer-tab-quotes");
    const recoveryStatus = integrationContainer.querySelector("[data-return-status]");
    expect(windowObject.location.pathname).toBe("/app/customers/customer-one");
    expect(restoredDisclosure?.open).toBe(true);
    expect(restoredTab?.getAttribute("aria-selected")).toBe("true");
    expect(integrationContainer.querySelector('[data-opportunity-id="quote-exact"]')).toBeNull();
    expect(document.activeElement).toBe(
      integrationContainer.querySelector("#ambient-client-overview-title")
    );
    expect(recoveryStatus?.dataset.returnStatus).toBe("recovery");
    expect(recoveryStatus?.textContent).toMatch(/exact previous control is no longer available/i);
    expect(mocks.getCustomerWorkspace).toHaveBeenCalledTimes(2);
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});
