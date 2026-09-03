// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AmbientCustomerDirectoryView from "../AmbientCustomerDirectoryView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  adapter: null,
  getCustomerDirectoryPage: vi.fn(),
  hostProps: null,
  navigation: null
}));

vi.mock("../../lib/customerWorkspace", () => ({
  getCustomerDirectoryPage: mocks.getCustomerDirectoryPage
}));

vi.mock("../../hooks/useWorkspaceRouteHeadingFocus", () => ({
  useWorkspaceRouteHeadingFocus: () => ({ current: null })
}));

vi.mock("../../context/WorkspaceNavigationContext", () => ({
  useOptionalWorkspaceNavigation: () => mocks.navigation,
  useWorkspaceReturnContextAdapter: (adapter) => {
    mocks.adapter = adapter;
    return { destination: null, status: null };
  }
}));

vi.mock("../AmbientClientsView", () => ({
  AmbientClientsDirectoryHost: (props) => {
    mocks.hostProps = props;
    return null;
  }
}));

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.adapter = null;
  mocks.hostProps = null;
  mocks.navigation = {
    location: { search: "", state: { retained: "history-state" } },
    replace: vi.fn()
  };
  mocks.getCustomerDirectoryPage.mockReset().mockResolvedValue({
    source: "firestore",
    items: [],
    nextCursor: ""
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderDirectory(props = {}) {
  await act(async () => {
    root.render(
      <AmbientCustomerDirectoryView
        organizationId="org-alpha"
        currentUserRole="sales"
        {...props}
      />
    );
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("AmbientCustomerDirectoryView", () => {
  test("never carries a prior organization's search, cursor, or cursor history into the next organization", async () => {
    mocks.getCustomerDirectoryPage.mockImplementation(async ({ organizationId, search, cursor }) => ({
      source: "firestore",
      items: [],
      nextCursor: organizationId === "org-alpha" && search === "private-alpha@example.com" && !cursor
        ? "alpha-next-cursor"
        : ""
    }));

    await renderDirectory();

    act(() => mocks.hostProps.onSearchDraftChange("private-alpha@example.com"));
    act(() => mocks.hostProps.onApplySearch({ preventDefault: vi.fn() }));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => mocks.hostProps.onNextPage());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(mocks.getCustomerDirectoryPage).toHaveBeenCalledWith({
      organizationId: "org-alpha",
      search: "private-alpha@example.com",
      cursor: "alpha-next-cursor"
    });
    expect(mocks.adapter.capture().transient).toEqual({
      searchDraft: "private-alpha@example.com",
      search: "private-alpha@example.com",
      cursor: "alpha-next-cursor",
      cursorHistory: [""]
    });

    await renderDirectory({ organizationId: " org-bravo " });

    const bravoReads = mocks.getCustomerDirectoryPage.mock.calls
      .map(([request]) => request)
      .filter((request) => request.organizationId === "org-bravo");
    expect(bravoReads).toEqual([{
      organizationId: "org-bravo",
      search: "",
      cursor: ""
    }]);
    expect(mocks.hostProps.searchDraft).toBe("");
    expect(mocks.hostProps.cursorHistoryLength).toBe(0);
    expect(mocks.adapter.capture().transient).toEqual({
      searchDraft: "",
      search: "",
      cursor: "",
      cursorHistory: []
    });
  });

  test.each([
    ["invalid", "?view=not-a-view&search=private", "/app/customers", "all"],
    ["duplicate", "?view=linked&view=upcoming", "/app/customers", "all"],
    ["duplicate same value", "?view=linked&view=linked", "/app/customers", "all"],
    ["extra", "?campaign=private&view=upcoming", "/app/customers?view=upcoming", "upcoming"],
    ["extra without a view", "?campaign=private", "/app/customers", "all"]
  ])("canonicalizes a %s Clients query without retaining unrelated values", async (
    _case,
    search,
    expectedDestination,
    expectedFilter
  ) => {
    mocks.navigation.location.search = search;

    await renderDirectory();

    expect(mocks.hostProps.directoryFilter).toBe(expectedFilter);
    expect(mocks.navigation.replace).toHaveBeenCalledTimes(1);
    expect(mocks.navigation.replace).toHaveBeenCalledWith(expectedDestination, {
      state: { retained: "history-state" },
      preserveSearch: false,
      preserveHash: false
    });
    expect(mocks.navigation.replace.mock.calls[0][0]).not.toMatch(/private|campaign|search/iu);
  });

  test("keeps one exact allowlisted Clients view query without replacing its history entry", async () => {
    mocks.navigation.location.search = "?view=linked";

    await renderDirectory();

    expect(mocks.hostProps.directoryFilter).toBe("linked");
    expect(mocks.navigation.replace).not.toHaveBeenCalled();
  });
});
