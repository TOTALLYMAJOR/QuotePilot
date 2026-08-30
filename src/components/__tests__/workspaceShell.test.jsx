// @vitest-environment jsdom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import WorkspaceShell from "../WorkspaceShell";
import { WorkspaceToolSurface } from "../WorkspaceSurfaceBoundary";
import { buildWorkspaceShellModel } from "../../lib/workspaceShellModel";
import { WORKSPACE_ROUTE_IDS } from "../../lib/workspaceRoutes";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPERATION_LABELS = [
  "Event Schedule",
  "Staff",
  "Reporting Dashboard",
  "Integrations Ops",
  "Import Studio",
  "Catalog Admin",
  "Session Diagnostics"
];

function model(routeId = WORKSPACE_ROUTE_IDS.HOME, workspace = true, isAdmin = true) {
  return buildWorkspaceShellModel({
    route: { routeId },
    customerCenteredWorkspaceEnabled: workspace,
    isAdmin
  });
}

function createProps(overrides = {}) {
  const actions = {
    onHome: vi.fn(),
    onCustomers: vi.fn(),
    onSearch: vi.fn(),
    onNewQuote: vi.fn(),
    onQuotes: vi.fn(),
    onEvents: vi.fn(),
    onClearDeck: vi.fn(),
    onOperations: vi.fn(),
    onMessages: vi.fn(),
    onWorkflow: vi.fn(),
    onStaff: vi.fn(),
    onSchedule: vi.fn(),
    onReporting: vi.fn(),
    onIntegrations: vi.fn(),
    onImports: vi.fn(),
    onCatalog: vi.fn(),
    onDiagnostics: vi.fn(),
    onPortal: vi.fn(),
    onPilot: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides.actions
  };
  const triggerRefs = {
    headerMenus: createRef(),
    search: createRef(),
    quotes: createRef(),
    workflow: createRef(),
    operations: createRef(),
    account: createRef(),
    more: createRef(),
    pilot: createRef(),
    ...overrides.triggerRefs
  };
  return {
    model: model(),
    identity: {
      workspaceName: "Smith Hospitality",
      tenantBrandName: "Smith Hospitality",
      tenantBrandTagline: "Remarkable gatherings",
      tenantBrandLogoUrl: "",
      organizationName: "Smith Catering LLC",
      brandCrew: []
    },
    principal: {
      email: "admin@smith.test",
      role: "admin",
      isAdmin: true
    },
    capabilities: {
      customerPortal: true,
      staffDirectory: true,
      eventSchedule: true,
      reportingDashboard: true,
      integrationsOps: true,
      diagnostics: true
    },
    draftStatus: { dirty: false, editing: false, quoteNumber: "" },
    attentionCount: null,
    sounds: { enabled: false, onToggle: vi.fn() },
    menu: { openId: "", onOpenChange: vi.fn() },
    searchSurface: null,
    children: <main data-testid="shell-child">Opportunity content</main>,
    themeVars: { "--tone-gold-2": "#aa7711" },
    ambientOpportunity: false,
    ambientNavigation: false,
    ...overrides,
    actions,
    triggerRefs
  };
}

function buttonsByText(container, label) {
  return Array.from(container.querySelectorAll("button"))
    .filter((button) => button.textContent.trim() === label);
}

function ToolSurfaceProbe({ label, open, presentation = "embedded", onClose, returnFocusRef }) {
  return (
    <button
      type="button"
      data-testid="tool-surface-probe"
      data-open={String(open)}
      data-presentation={presentation}
      data-return-focus={String(Boolean(returnFocusRef))}
      onClick={onClose}
    >
      {label}
    </button>
  );
}
ToolSurfaceProbe.retry = vi.fn();

describe("WorkspaceShell", () => {
  let container;
  let root;
  let currentProps;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(overrides = {}) {
    currentProps = createProps(overrides);
    act(() => root.render(<WorkspaceShell {...currentProps} />));
    return currentProps;
  }

  test("renders workspace orientation, identity, crew, theme, ambient class, and active Now state", () => {
    render({
      identity: {
        workspaceName: "Smith Hospitality",
        tenantBrandName: "Smith Hospitality",
        tenantBrandTagline: "Remarkable gatherings",
        tenantBrandLogoUrl: "/tenant-mark.png",
        organizationName: "Smith Catering LLC",
        brandCrew: [
          { label: "Avery", imageUrl: "/avery.png" },
          { label: "Morgan", imageUrl: "" }
        ]
      },
      ambientOpportunity: true
    });

    const shell = container.querySelector(".app-shell");
    expect(shell.classList.contains("app-shell-neutral")).toBe(true);
    expect(shell.classList.contains("app-shell-ambient-opportunity")).toBe(true);
    expect(shell.style.getPropertyValue("--tone-gold-2")).toBe("#aa7711");
    expect(container.querySelector('[aria-label="QuotePilot by MBMApps"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Current workspace: Smith Hospitality"]')).not.toBeNull();
    expect(container.textContent).toContain("Remarkable gatherings");
    expect(container.textContent).toContain("Avery");
    expect(container.textContent).toContain("Morgan");
    expect(container.querySelector('img[src="/avery.png"]').alt).toBe("Avery");
    expect(container.querySelectorAll('img[src="/tenant-mark.png"]')).toHaveLength(2);

    const home = buttonsByText(container, "Now")[0];
    expect(home.classList.contains("nav-view-active")).toBe(true);
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(buttonsByText(container, "Customers")).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Search"]')?.title)
      .toBe("Search customers and quotes (Ctrl or Command K)");
    expect(container.querySelector('[data-capability-entry="event-messaging-station"]')?.textContent)
      .toBe("Messages");
    expect(container.querySelector('[data-testid="shell-child"]').textContent).toBe("Opportunity content");
  });

  test("reduces ambient workspace navigation to exact orientation and utility actions", () => {
    const props = render({ ambientNavigation: true });
    const shell = container.querySelector(".app-shell");
    const orientation = Array.from(container.querySelectorAll("[data-ambient-orientation]"));

    expect(shell.classList.contains("app-shell-ambient-navigation")).toBe(true);
    expect(shell.dataset.ambientNavigation).toBe("orientation");
    expect(orientation.map((button) => button.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Clients", "Library"]);
    expect(orientation.every((button) => button.classList.contains("ambient-orientation-action"))).toBe(true);
    expect(buttonsByText(container, "Home")).toHaveLength(0);
    expect(buttonsByText(container, "Customers")).toHaveLength(0);
    expect(buttonsByText(container, "Quotes")).toHaveLength(0);
    expect(buttonsByText(container, "Messages")).toHaveLength(0);
    expect(buttonsByText(container, "Workflow")).toHaveLength(0);

    const now = buttonsByText(container, "Now")[0];
    const opportunities = buttonsByText(container, "Opportunities")[0];
    const clients = buttonsByText(container, "Clients")[0];
    const library = buttonsByText(container, "Library")[0];
    const search = container.querySelector('button[aria-label="Search"]');
    const newQuote = buttonsByText(container, "New quote")[0];
    const pilot = container.querySelector('button[data-ambient-utility="pilot"]');
    expect(now.getAttribute("aria-current")).toBe("page");
    expect(now.classList.contains("nav-view-active")).toBe(true);
    expect(search.dataset.ambientUtility).toBe("search");
    expect(search.classList.contains("ambient-utility-action")).toBe(true);
    expect(newQuote.dataset.ambientUtility).toBe("new-quote");
    expect(newQuote.classList.contains("ambient-utility-action")).toBe(true);
    expect(pilot.dataset.ambientUtility).toBe("pilot");
    expect(pilot.dataset.ambientActionId).toBe("open-global-pilot-context");
    expect(pilot.getAttribute("aria-label")).toBe("Open Pilot for the current context");
    expect(container.querySelectorAll("button.cta")).toHaveLength(1);

    act(() => now.click());
    act(() => opportunities.click());
    act(() => clients.click());
    act(() => library.click());
    act(() => search.click());
    act(() => newQuote.click());
    act(() => pilot.click());
    expect(props.actions.onHome).toHaveBeenCalledTimes(1);
    expect(props.actions.onQuotes).toHaveBeenCalledTimes(1);
    expect(props.actions.onCustomers).toHaveBeenCalledTimes(1);
    expect(props.actions.onCatalog).toHaveBeenCalledTimes(1);
    expect(props.actions.onSearch).toHaveBeenCalledWith(search);
    expect(props.actions.onNewQuote).toHaveBeenCalledTimes(1);
    expect(props.actions.onPilot).toHaveBeenCalledTimes(1);
  });

  test("keeps Opportunities and Library current across their exact ambient routes", () => {
    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, true, true)
    });
    const opportunities = buttonsByText(container, "Opportunities")[0];
    expect(opportunities.classList.contains("nav-view-active")).toBe(true);
    expect(opportunities.getAttribute("aria-current")).toBe("page");

    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.CATALOG, true, true)
    });
    const library = buttonsByText(container, "Library")[0];
    expect(library.classList.contains("nav-view-active")).toBe(true);
    expect(library.getAttribute("aria-current")).toBe("page");

  });

  test("keeps Library absent for sales while retaining role-safe ambient orientation", () => {
    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.HOME, true, false),
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      menu: { openId: "operations", onOpenChange: vi.fn() }
    });

    expect(Array.from(container.querySelectorAll("[data-ambient-orientation]"))
      .map((button) => button.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Clients"]);
    expect(buttonsByText(container, "Library")).toHaveLength(0);
    expect(buttonsByText(container, "Catalog Admin")).toHaveLength(0);
  });

  test("retains contextual Events, Staff, Messages, and Workflow in ambient Operations and More menus", () => {
    const onOpenChange = vi.fn();
    const props = render({
      ambientNavigation: true,
      attentionCount: 2,
      menu: { openId: "operations", onOpenChange }
    });
    const operations = container.querySelector('[role="menu"][aria-label="Operations"]');
    const clearDeck = buttonsByText(operations, "Clear the Deck")[0];
    const switchboard = buttonsByText(operations, "Operations switchboard")[0];
    const events = buttonsByText(operations, "Events")[0];
    const messages = buttonsByText(operations, "Messages")[0];
    const workflow = operations.querySelector('button[aria-label="Workflow, 2 quotes need attention"]');
    const staff = buttonsByText(operations, "Staff")[0];
    expect(clearDeck.dataset.capabilityEntry).toBe("live-operations-planning");
    expect(switchboard.dataset.capabilityEntry).toBe("live-operations-planning");
    expect(events.dataset.capabilityEntry).toBe("live-operations-planning");
    expect(messages.dataset.capabilityEntry).toBe("event-messaging-station");
    expect(staff).not.toBeNull();
    expect(workflow.querySelector(".workflow-attention-badge").textContent).toBe("2");
    expect(buttonsByText(operations, "Catalog Admin")).toHaveLength(0);

    act(() => clearDeck.click());
    act(() => switchboard.click());
    act(() => events.click());
    act(() => messages.click());
    act(() => workflow.click());
    act(() => staff.click());
    expect(onOpenChange).toHaveBeenCalledTimes(6);
    expect(onOpenChange).toHaveBeenNthCalledWith(1, "");
    expect(onOpenChange).toHaveBeenNthCalledWith(2, "");
    expect(onOpenChange).toHaveBeenNthCalledWith(3, "");
    expect(onOpenChange).toHaveBeenNthCalledWith(4, "");
    expect(onOpenChange).toHaveBeenNthCalledWith(5, "");
    expect(onOpenChange).toHaveBeenNthCalledWith(6, "");
    expect(props.actions.onClearDeck).toHaveBeenCalledTimes(1);
    expect(props.actions.onOperations).toHaveBeenCalledTimes(1);
    expect(props.actions.onEvents).toHaveBeenCalledTimes(1);
    expect(props.actions.onMessages).toHaveBeenCalledTimes(1);
    expect(props.actions.onWorkflow).toHaveBeenCalledTimes(1);
    expect(props.actions.onStaff).toHaveBeenCalledTimes(1);

    render({
      ambientNavigation: true,
      attentionCount: 1,
      menu: { openId: "more", onOpenChange: vi.fn() }
    });
    const more = container.querySelector('[role="menu"][aria-label="More"]');
    expect(buttonsByText(more, "Messages")).toHaveLength(1);
    expect(more.querySelector('button[aria-label="Workflow, 1 quote needs attention"]')).not.toBeNull();
  });

  test("keeps legacy navigation compact and suppresses active Quotes while the builder is open", () => {
    render({ model: model(WORKSPACE_ROUTE_IDS.HOME, false, false) });

    expect(container.querySelector(".app-shell").classList.contains("app-shell-neutral")).toBe(false);
    expect(buttonsByText(container, "Home")).toHaveLength(0);
    expect(buttonsByText(container, "Customers")).toHaveLength(0);
    expect(container.querySelector('button[aria-label="Search"]')).toBeNull();
    expect(buttonsByText(container, "Messages")).toHaveLength(0);
    expect(buttonsByText(container, "New quote")).toHaveLength(1);
    expect(buttonsByText(container, "Quotes")[0].classList.contains("nav-view-active")).toBe(false);
    expect(buttonsByText(container, "Workflow")).toHaveLength(1);
  });

  test.each([
    [WORKSPACE_ROUTE_IDS.CUSTOMER_LIST, "Customers"],
    [WORKSPACE_ROUTE_IDS.QUOTE_LIST, "Quotes"],
    [WORKSPACE_ROUTE_IDS.MESSAGING, "Messages"],
    [WORKSPACE_ROUTE_IDS.WORKFLOW, "Workflow"]
  ])("reflects %s through the current navigation active state", (routeId, label) => {
    render({ model: model(routeId, true, true), attentionCount: routeId === WORKSPACE_ROUTE_IDS.WORKFLOW ? 2 : null });
    const button = label === "Workflow"
      ? container.querySelector('button[aria-label^="Workflow"]')
      : buttonsByText(container, label)[0];
    expect(button.classList.contains("nav-view-active")).toBe(true);
    if (["Customers", "Messages"].includes(label)) {
      expect(button.getAttribute("aria-current")).toBe("page");
    }
    if (label === "Workflow") {
      expect(button.getAttribute("aria-label")).toBe("Workflow, 2 quotes need attention");
      expect(button.querySelector(".workflow-attention-badge").textContent).toBe("2");
    }
  });

  test("preserves admin operation labels while sales and tenant feature gates fail closed", () => {
    render({ menu: { openId: "operations", onOpenChange: vi.fn() } });
    const adminMenu = container.querySelector('[role="menu"][aria-label="Operations"]');
    expect(Array.from(adminMenu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent.trim()))
      .toEqual(OPERATION_LABELS);

    render({
      model: model(WORKSPACE_ROUTE_IDS.HOME, true, false),
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      capabilities: {
        customerPortal: true,
        eventSchedule: false,
        reportingDashboard: true,
        integrationsOps: false,
        diagnostics: true
      },
      menu: { openId: "operations", onOpenChange: vi.fn() }
    });
    const salesMenu = container.querySelector('[role="menu"][aria-label="Operations"]');
    expect(Array.from(salesMenu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent.trim()))
      .toEqual(["Reporting Dashboard", "Session Diagnostics"]);
  });

  test("keeps desktop Operations and mobile More operational content in exact parity", () => {
    render({ menu: { openId: "operations", onOpenChange: vi.fn() } });
    const desktopLabels = Array.from(
      container.querySelector('[role="menu"][aria-label="Operations"]').querySelectorAll('[role="menuitem"]')
    ).map((item) => item.textContent.trim());

    render({ menu: { openId: "more", onOpenChange: vi.fn() } });
    const mobileLabels = Array.from(
      container.querySelector('[role="menu"][aria-label="More"]').querySelectorAll('[role="menuitem"]')
    ).map((item) => item.textContent.trim()).filter((label) => OPERATION_LABELS.includes(label));

    expect(mobileLabels).toEqual(desktopLabels);
    expect(mobileLabels).toEqual(OPERATION_LABELS);
  });

  test("keeps the sales mobile menu role-safe and respects the portal capability gate", () => {
    render({
      model: model(WORKSPACE_ROUTE_IDS.HOME, true, false),
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      capabilities: {
        customerPortal: false,
        eventSchedule: true,
        reportingDashboard: true,
        integrationsOps: true,
        diagnostics: true
      },
      menu: { openId: "more", onOpenChange: vi.fn() }
    });

    const more = container.querySelector('[role="menu"][aria-label="More"]');
    expect(more.textContent).toContain("sales@smith.test");
    expect(more.textContent).toContain("sales");
    expect(buttonsByText(more, "Import Studio")).toHaveLength(0);
    expect(buttonsByText(more, "Catalog Admin")).toHaveLength(0);
    expect(buttonsByText(more, "Customer Portal")).toHaveLength(0);
    expect(buttonsByText(more, "Event Schedule")).toHaveLength(1);
  });

  test("preserves account identity, portal, sound preference, and sign-out behavior", () => {
    const onOpenChange = vi.fn();
    const onToggle = vi.fn();
    const props = render({
      menu: { openId: "account", onOpenChange },
      sounds: { enabled: true, onToggle }
    });
    const account = container.querySelector('[role="menu"][aria-label="Account"]');
    expect(account.textContent).toContain("admin@smith.test");
    expect(account.textContent).toContain("admin");

    const sound = buttonsByText(account, "Sounds: On")[0];
    expect(sound.getAttribute("aria-pressed")).toBe("true");
    act(() => sound.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => buttonsByText(account, "Customer Portal")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onPortal).toHaveBeenCalledTimes(1);

    onOpenChange.mockClear();
    act(() => buttonsByText(account, "Sign Out")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onSignOut).toHaveBeenCalledTimes(1);
  });

  test("truthfully distinguishes dirty, editing, and new-draft intro states", () => {
    render({ draftStatus: { dirty: true, editing: true, quoteNumber: "QP-101" } });
    expect(container.querySelector(".workspace-save-state").textContent).toBe("Unsaved changes");
    expect(container.querySelector(".workspace-save-state").classList.contains("is-dirty")).toBe(true);

    render({ draftStatus: { dirty: false, editing: true, quoteNumber: "QP-101" } });
    expect(container.querySelector(".workspace-save-state").textContent)
      .toBe("Editing QP-101 · all changes saved");

    render({ draftStatus: { dirty: false, editing: false, quoteNumber: "" } });
    expect(container.querySelector(".workspace-save-state").textContent).toBe("Workspace open");
    expect(container.querySelector(".workspace-intro strong").textContent).toBe("Smith Catering LLC");
  });

  test("renders the search slot and hands the exact trigger element to its caller", () => {
    const onOpenChange = vi.fn();
    const props = render({
      menu: { openId: "account", onOpenChange },
      searchSurface: <section data-testid="search-surface">Scoped search results</section>
    });
    const searchButton = container.querySelector('button[aria-label="Search"]');
    expect(container.querySelector('[data-commercial-search-surface="true"] [data-testid="search-surface"]'))
      .not.toBeNull();
    expect(props.triggerRefs.search.current).toBe(searchButton);

    act(() => searchButton.click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onSearch).toHaveBeenCalledWith(searchButton);
  });

  test("keeps menu state controlled and hands each operations trigger ref to the action", () => {
    const onOpenChange = vi.fn();
    const props = render({ menu: { openId: "operations", onOpenChange } });
    const operationsTrigger = buttonsByText(container, "Operations")[0];
    expect(props.triggerRefs.operations.current).toBe(operationsTrigger);
    expect(operationsTrigger.getAttribute("aria-expanded")).toBe("true");

    act(() => buttonsByText(container, "Event Schedule")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onSchedule).toHaveBeenCalledWith(props.triggerRefs.operations);

    onOpenChange.mockClear();
    render({ menu: { openId: "more", onOpenChange } });
    const moreTrigger = buttonsByText(container, "More")[0];
    expect(currentProps.triggerRefs.more.current).toBe(moreTrigger);
    act(() => buttonsByText(container, "Event Schedule")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(currentProps.actions.onSchedule).toHaveBeenCalledWith(currentProps.triggerRefs.more);
  });

  test("requests controlled menu transitions without retaining local open state", () => {
    const onOpenChange = vi.fn();
    const props = render({ menu: { openId: "", onOpenChange } });
    expect(props.triggerRefs.account.current.getAttribute("aria-expanded")).toBe("false");
    act(() => props.triggerRefs.account.current.click());
    expect(onOpenChange).toHaveBeenCalledWith("account");
    expect(container.querySelector('[role="menu"][aria-label="Account"]')).toBeNull();

    onOpenChange.mockClear();
    render({ menu: { openId: "operations", onOpenChange } });
    act(() => currentProps.triggerRefs.operations.current.click());
    expect(onOpenChange).toHaveBeenCalledWith("");
  });

  test("hands navigation actions and refs back without owning route state", () => {
    const onOpenChange = vi.fn();
    const props = render({ menu: { openId: "account", onOpenChange } });
    expect(props.triggerRefs.headerMenus.current).toBe(container.querySelector(".header-actions"));
    expect(props.triggerRefs.quotes.current).toBe(buttonsByText(container, "Quotes")[0]);
    expect(props.triggerRefs.workflow.current).toBe(container.querySelector('button[aria-label="Workflow"]'));

    act(() => buttonsByText(container, "Customers")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onCustomers).toHaveBeenCalledTimes(1);

    act(() => buttonsByText(container, "New quote")[0].click());
    expect(props.actions.onNewQuote).toHaveBeenCalledTimes(1);
  });

  test("projects one operational surface into route and modal boundaries without changing its contract", () => {
    const onClose = vi.fn();
    const returnFocusRef = createRef();
    const commonProps = { label: "Shared operational tool" };

    act(() => root.render(
      <WorkspaceToolSurface
        mounted
        open
        presentation="route"
        surfaceName="Operational tool"
        component={ToolSurfaceProbe}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
        surfaceProps={commonProps}
      />
    ));
    let probe = container.querySelector('[data-testid="tool-surface-probe"]');
    expect(probe.dataset.presentation).toBe("embedded");
    expect(probe.dataset.returnFocus).toBe("false");
    act(() => probe.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.render(
      <WorkspaceToolSurface
        mounted
        open
        presentation="modal"
        surfaceName="Operational tool"
        component={ToolSurfaceProbe}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
        hasUnsavedWorkspaceChanges
        surfaceProps={commonProps}
      />
    ));
    probe = container.querySelector('[data-testid="tool-surface-probe"]');
    expect(probe.dataset.presentation).toBe("modal");
    expect(probe.dataset.returnFocus).toBe("true");

    act(() => root.render(
      <WorkspaceToolSurface
        mounted
        open={false}
        presentation="route"
        surfaceName="Operational tool"
        component={ToolSurfaceProbe}
        onClose={onClose}
        surfaceProps={commonProps}
      />
    ));
    const inactiveRoute = container.querySelector('[data-workspace-tool-surface="Operational tool"]');
    probe = container.querySelector('[data-testid="tool-surface-probe"]');
    expect(inactiveRoute).not.toBeNull();
    expect(inactiveRoute.hidden).toBe(true);
    expect(inactiveRoute.getAttribute("aria-hidden")).toBe("true");
    expect(inactiveRoute.dataset.workspaceToolOpen).toBe("false");
    expect(probe).not.toBeNull();
    expect(probe.dataset.open).toBe("false");

    act(() => root.render(
      <WorkspaceToolSurface
        mounted={false}
        open={false}
        presentation="modal"
        surfaceName="Operational tool"
        component={ToolSurfaceProbe}
        onClose={onClose}
        surfaceProps={commonProps}
      />
    ));
    expect(container.querySelector('[data-testid="tool-surface-probe"]')).toBeNull();
  });
});
