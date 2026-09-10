// @vitest-environment jsdom

import React, { act, createRef } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    onInventory: vi.fn(),
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
    onRequestPasswordReset: vi.fn().mockResolvedValue({ requestAccepted: true }),
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
      .toEqual(["Now", "Opportunities", "Operations", "Clients", "Library"]);
    expect(orientation.every((button) => button.classList.contains("ambient-orientation-action"))).toBe(true);
    expect(container.querySelector('[aria-label="Primary workspace"]')).not.toBeNull();
    expect(buttonsByText(container, "Home")).toHaveLength(0);
    expect(buttonsByText(container, "Customers")).toHaveLength(0);
    expect(buttonsByText(container, "Quotes")).toHaveLength(0);
    expect(buttonsByText(container, "Messages")).toHaveLength(0);
    expect(buttonsByText(container, "Workflow")).toHaveLength(0);

    const now = buttonsByText(container, "Now")[0];
    const opportunities = buttonsByText(container, "Opportunities")[0];
    const operations = buttonsByText(container, "Operations")[0];
    const clients = buttonsByText(container, "Clients")[0];
    const library = buttonsByText(container, "Library")[0];
    const search = container.querySelector('button[aria-label="Search"]');
    const newQuote = buttonsByText(container, "New quote")[0];
    expect(now.getAttribute("aria-current")).toBe("page");
    expect(now.classList.contains("nav-view-active")).toBe(true);
    expect(props.triggerRefs.operations.current).toBe(operations);
    expect(operations.querySelector("svg path").getAttribute("d"))
      .toBe("M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z");
    expect(container.querySelector('[role="menu"][aria-label="Operations"]')).toBeNull();
    expect(search.dataset.ambientUtility).toBe("search");
    expect(search.classList.contains("ambient-utility-action")).toBe(true);
    expect(newQuote.dataset.ambientUtility).toBe("new-quote");
    expect(newQuote.classList.contains("ambient-utility-action")).toBe(true);
    expect(container.querySelector('button[data-ambient-utility="pilot"]')).toBeNull();
    expect(buttonsByText(container, "Pilot")).toHaveLength(0);
    expect(container.querySelectorAll("button.cta")).toHaveLength(1);

    act(() => now.click());
    act(() => opportunities.click());
    act(() => operations.click());
    act(() => clients.click());
    act(() => library.click());
    act(() => search.click());
    act(() => newQuote.click());
    expect(props.actions.onHome).toHaveBeenCalledTimes(1);
    expect(props.actions.onQuotes).toHaveBeenCalledTimes(1);
    expect(props.actions.onOperations).toHaveBeenCalledTimes(1);
    expect(props.actions.onCustomers).toHaveBeenCalledTimes(1);
    expect(props.actions.onCatalog).toHaveBeenCalledTimes(1);
    expect(props.actions.onSearch).toHaveBeenCalledWith(search);
    expect(props.actions.onNewQuote).toHaveBeenCalledTimes(1);
    expect(props.actions.onPilot).not.toHaveBeenCalled();
  });

  test("removes primary and secondary Operations entry points when Calendar is unavailable", () => {
    render({
      ambientNavigation: true,
      capabilities: {
        customerPortal: true,
        staffDirectory: true,
        eventSchedule: false,
        reportingDashboard: true,
        integrationsOps: true,
        diagnostics: true
      },
      menu: { openId: "more", onOpenChange: vi.fn() }
    });

    expect(Array.from(container.querySelectorAll("[data-ambient-orientation]"))
      .map((button) => button.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Clients", "Library"]);
    const tools = container.querySelector('[role="dialog"][aria-labelledby="workspace-tools-title"]');
    const operationalTools = tools.querySelector('[data-workspace-tools-group="operations"]');
    expect(buttonsByText(operationalTools, "Operations")).toHaveLength(0);
    expect(buttonsByText(operationalTools, "Clear the Deck")).toHaveLength(1);
    expect(buttonsByText(operationalTools, "Staff")).toHaveLength(1);
    expect(currentProps.triggerRefs.operations.current).toBeNull();
    expect(currentProps.actions.onOperations).not.toHaveBeenCalled();
  });

  test("removes redundant ambient workspace labeling while retaining contextual quote status", () => {
    render({ ambientNavigation: true });
    expect(container.querySelector(".workspace-intro")).toBeNull();

    render({
      ambientNavigation: true,
      draftStatus: { dirty: false, editing: true, quoteNumber: "QP-101" }
    });
    expect(container.querySelector(".workspace-intro strong").textContent).toBe("Quote status");
    expect(container.querySelector(".workspace-save-state").textContent)
      .toBe("Editing QP-101 · all changes saved");
  });

  test("keeps Opportunities, Operations, and Library current without promoting contextual event routes", () => {
    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.QUOTE_DETAIL, true, true)
    });
    const opportunities = buttonsByText(container, "Opportunities")[0];
    expect(opportunities.classList.contains("nav-view-active")).toBe(true);
    expect(opportunities.getAttribute("aria-current")).toBe("page");

    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.OPERATIONS, true, true)
    });
    const operations = buttonsByText(container, "Operations")[0];
    expect(operations.classList.contains("nav-view-active")).toBe(true);
    expect(operations.getAttribute("aria-current")).toBe("page");

    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.CATALOG, true, true)
    });
    const library = buttonsByText(container, "Library")[0];
    expect(library.classList.contains("nav-view-active")).toBe(true);
    expect(library.getAttribute("aria-current")).toBe("page");

    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.EVENT_LIVE, true, true)
    });
    expect(buttonsByText(container, "Events")).toHaveLength(0);
    expect(container.querySelector('[aria-label="Primary workspace"] [aria-current="page"]')).toBeNull();
  });

  test("gives sales staff read-only Library navigation without Catalog Admin", () => {
    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.HOME, true, false),
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      menu: { openId: "operations", onOpenChange: vi.fn() }
    });

    expect(Array.from(container.querySelectorAll("[data-ambient-orientation]"))
      .map((button) => button.textContent.trim()))
      .toEqual(["Now", "Opportunities", "Operations", "Clients", "Library"]);
    expect(buttonsByText(container, "Library")).toHaveLength(1);
    expect(buttonsByText(container, "Catalog Admin")).toHaveLength(0);
    expect(container.querySelector('[role="menu"][aria-label="Operations"]')).toBeNull();
  });

  test("keeps daily execution concise while Workspace tools preserve other reachability", () => {
    render({
      ambientNavigation: true,
      attentionCount: 1,
      menu: { openId: "more", onOpenChange: vi.fn() }
    });
    const tools = container.querySelector('[role="dialog"][aria-labelledby="workspace-tools-title"]');
    expect(Array.from(tools.querySelectorAll("[data-workspace-tools-group]"))
      .map((group) => group.dataset.workspaceToolsGroup))
      .toEqual(["workspace", "frequent", "operations", "administration", "account"]);
    const frequentTools = tools.querySelector('[data-workspace-tools-group="frequent"]');
    const operationalTools = tools.querySelector('[data-workspace-tools-group="operations"]');
    const administration = tools.querySelector('[data-workspace-tools-group="administration"]');
    const mobileOperations = buttonsByText(tools, "Operations")[0];
    const mobileWorkflow = tools.querySelector('button[aria-label="Workflow, 1 quote needs attention"]');
    const administrationToggle = administration.querySelector(
      '[data-workspace-tools-administration-toggle="true"]'
    );
    expect(frequentTools.querySelector("h3").textContent).toBe("Frequent tools");
    expect(operationalTools.querySelector("h3").textContent).toBe("Operations");
    expect(administration.querySelector("h3").textContent).toBe("Administration");
    expect(mobileOperations.dataset.capabilityEntry).toBe("live-operations-planning");
    expect(Array.from(operationalTools.querySelectorAll("button")).map((button) => button.textContent.trim()))
      .toEqual(["Operations", "Clear the Deck", "Staff"]);
    expect(buttonsByText(operationalTools, "Clear the Deck")).toHaveLength(1);
    expect(buttonsByText(operationalTools, "Events")).toHaveLength(0);
    expect(buttonsByText(operationalTools, "Event Schedule")).toHaveLength(0);
    expect(buttonsByText(frequentTools, "Messages")).toHaveLength(1);
    expect(buttonsByText(frequentTools, "Pilot")).toHaveLength(1);
    expect(buttonsByText(operationalTools, "Staff")).toHaveLength(1);
    expect(administrationToggle.getAttribute("aria-expanded")).toBe("false");
    expect(administrationToggle.getAttribute("aria-controls"))
      .toBe("workspace-tools-administration-actions");
    expect(buttonsByText(tools, "Reporting Dashboard")).toHaveLength(0);
    expect(buttonsByText(tools, "Session Diagnostics")).toHaveLength(0);
    expect(buttonsByText(tools, "Integrations Ops")).toHaveLength(0);
    expect(buttonsByText(tools, "Import Studio")).toHaveLength(0);
    expect(mobileWorkflow).not.toBeNull();

    act(() => administrationToggle.click());
    expect(administrationToggle.getAttribute("aria-expanded")).toBe("true");
    expect(buttonsByText(administration, "Reporting Dashboard")).toHaveLength(1);
    expect(buttonsByText(administration, "Integrations Ops")).toHaveLength(1);
    expect(buttonsByText(administration, "Import Studio")).toHaveLength(1);
    expect(buttonsByText(administration, "Session Diagnostics")).toHaveLength(1);
    act(() => mobileOperations.click());
    act(() => buttonsByText(frequentTools, "Messages")[0].click());
    act(() => mobileWorkflow.click());
    act(() => buttonsByText(operationalTools, "Staff")[0].click());
    act(() => buttonsByText(administration, "Integrations Ops")[0].click());
    act(() => buttonsByText(administration, "Import Studio")[0].click());
    expect(currentProps.actions.onOperations).toHaveBeenCalledTimes(1);
    expect(currentProps.actions.onMessages).toHaveBeenCalledTimes(1);
    expect(currentProps.actions.onWorkflow).toHaveBeenCalledTimes(1);
    expect(currentProps.actions.onStaff).toHaveBeenCalledTimes(1);
    expect(currentProps.actions.onIntegrations).toHaveBeenCalledTimes(1);
    expect(currentProps.actions.onImports).toHaveBeenCalledTimes(1);
  });

  test("surfaces ingredient Inventory only for an enabled administrator", () => {
    render({
      ambientNavigation: true,
      capabilities: {
        ...createProps().capabilities,
        inventoryAuthority: true
      },
      menu: { openId: "more", onOpenChange: vi.fn() }
    });
    const tools = container.querySelector('[role="dialog"][aria-labelledby="workspace-tools-title"]');
    const operationalTools = tools.querySelector('[data-workspace-tools-group="operations"]');
    const inventory = buttonsByText(operationalTools, "Inventory")[0];
    expect(inventory.dataset.capabilityEntry).toBe("inventory-workspace");
    act(() => inventory.click());
    expect(currentProps.actions.onInventory).toHaveBeenCalledTimes(1);

    render({
      ambientNavigation: true,
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      capabilities: {
        ...createProps().capabilities,
        inventoryAuthority: true
      },
      menu: { openId: "more", onOpenChange: vi.fn() }
    });
    expect(buttonsByText(container, "Inventory")).toHaveLength(0);
  });

  test("keeps progressive administration collapsed, unmounted, and role-safe", () => {
    render({
      ambientNavigation: true,
      model: model(WORKSPACE_ROUTE_IDS.HOME, true, false),
      principal: { email: "sales@smith.test", role: "sales", isAdmin: false },
      capabilities: {
        customerPortal: true,
        eventSchedule: true,
        staffDirectory: true,
        reportingDashboard: true,
        integrationsOps: false,
        diagnostics: true
      },
      menu: { openId: "more", onOpenChange: vi.fn() }
    });

    const tools = container.querySelector('[role="dialog"][aria-labelledby="workspace-tools-title"]');
    const administration = tools.querySelector('[data-workspace-tools-group="administration"]');
    const toggle = administration.querySelector('[data-workspace-tools-administration-toggle="true"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(tools.querySelector("#workspace-tools-administration-actions")).toBeNull();
    expect(buttonsByText(tools, "Reporting Dashboard")).toHaveLength(0);
    expect(buttonsByText(tools, "Session Diagnostics")).toHaveLength(0);

    act(() => {
      toggle.focus();
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(buttonsByText(administration, "Reporting Dashboard")).toHaveLength(1);
    expect(buttonsByText(administration, "Session Diagnostics")).toHaveLength(1);
    expect(buttonsByText(administration, "Integrations Ops")).toHaveLength(0);
    expect(buttonsByText(administration, "Import Studio")).toHaveLength(0);

    act(() => {
      toggle.focus();
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(tools.querySelector("#workspace-tools-administration-actions")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test("opens the explicit mobile Workspace and tools dialog with focus containment and restoration", () => {
    const onOpenChange = vi.fn();
    const props = render({ ambientNavigation: true, menu: { openId: "", onOpenChange } });
    const trigger = props.triggerRefs.more.current;
    expect(trigger.getAttribute("aria-label")).toBe("Workspace and tools");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    act(() => trigger.click());
    expect(onOpenChange).toHaveBeenCalledWith("more");

    onOpenChange.mockClear();
    render({
      ambientNavigation: true,
      menu: { openId: "more", onOpenChange },
      triggerRefs: props.triggerRefs
    });
    const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
    const closeButton = buttonsByText(dialog, "×")[0];
    const search = buttonsByText(dialog, "Search customers and opportunities")[0];
    const signOut = buttonsByText(dialog, "Sign Out")[0];
    expect(dialog.textContent).toContain("admin@smith.test");
    expect(dialog.querySelector('[aria-label="Current workspace: Smith Hospitality"]')).not.toBeNull();
    expect(dialog.textContent).toContain("Current workspace");
    expect(buttonsByText(dialog, "Switch workspace")).toHaveLength(0);
    expect(buttonsByText(dialog, "Account settings")).toHaveLength(1);
    expect(document.activeElement).toBe(search);
    expect(container.querySelector(".site-header").hasAttribute("inert")).toBe(true);
    expect(container.querySelector('[data-testid="shell-child"]').hasAttribute("inert")).toBe(true);

    act(() => closeButton.focus());
    act(() => closeButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true
    })));
    expect(document.activeElement).toBe(signOut);
    act(() => signOut.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(closeButton);

    act(() => closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith("");

    render({
      ambientNavigation: true,
      menu: { openId: "", onOpenChange },
      triggerRefs: props.triggerRefs
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".site-header").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(currentProps.triggerRefs.more.current);
  });

  test("opens account settings from Workspace and tools without inventing workspace switching or sending email", () => {
    const onRequestPasswordReset = vi.fn().mockResolvedValue({ requestAccepted: true });
    const onOpenChange = vi.fn();
    const props = render({
      ambientNavigation: true,
      menu: { openId: "more", onOpenChange },
      actions: { onRequestPasswordReset }
    });
    const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
    const accountSettings = buttonsByText(dialog, "Account settings")[0];

    expect(buttonsByText(dialog, "Switch workspace")).toHaveLength(0);
    expect(accountSettings).not.toBeNull();
    act(() => accountSettings.click());
    expect(onOpenChange).toHaveBeenCalledWith("account-settings");
    expect(onRequestPasswordReset).not.toHaveBeenCalled();

    onOpenChange.mockClear();
    render({
      ambientNavigation: true,
      menu: { openId: "account-settings", onOpenChange },
      triggerRefs: props.triggerRefs,
      actions: { onRequestPasswordReset }
    });
    const settings = container.querySelector('[role="dialog"][aria-labelledby="account-settings-title"]');
    expect(settings.textContent).toContain("admin@smith.test");
    expect(settings.textContent).toContain("Smith Hospitality");
    expect(settings.textContent).toContain("Nothing changes until that link is completed");
    expect(onRequestPasswordReset).not.toHaveBeenCalled();
    expect(document.activeElement.getAttribute("aria-label")).toBe("Close account settings");
    expect(container.querySelector(".site-header").hasAttribute("inert")).toBe(true);
    expect(props.actions.onSignOut).not.toHaveBeenCalled();
  });

  test("sends a password reset only on explicit request and preserves a retry after failure", async () => {
    const onRequestPasswordReset = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ requestAccepted: true });
    render({
      ambientNavigation: true,
      menu: { openId: "account-settings", onOpenChange: vi.fn() },
      actions: { onRequestPasswordReset }
    });
    const settings = container.querySelector('[role="dialog"][aria-labelledby="account-settings-title"]');
    const requestReset = buttonsByText(settings, "Send password reset email")[0];

    expect(onRequestPasswordReset).not.toHaveBeenCalled();
    await act(async () => {
      requestReset.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRequestPasswordReset).toHaveBeenNthCalledWith(1, { email: "admin@smith.test" });
    expect(settings.querySelector('[role="alert"]').textContent)
      .toContain("Check your connection and try again");
    expect(requestReset.disabled).toBe(false);

    await act(async () => {
      requestReset.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRequestPasswordReset).toHaveBeenCalledTimes(2);
    expect(settings.querySelector('[role="status"]').textContent)
      .toBe("Password reset email requested for admin@smith.test.");
    expect(buttonsByText(settings, "Reset email requested")[0].disabled).toBe(true);
  });

  test("traps account-settings focus, closes by Escape, and restores the Workspace and tools trigger", () => {
    const onOpenChange = vi.fn();
    const props = render({ ambientNavigation: true, menu: { openId: "more", onOpenChange } });
    act(() => buttonsByText(container, "Account settings")[0].click());

    onOpenChange.mockClear();
    render({
      ambientNavigation: true,
      menu: { openId: "account-settings", onOpenChange },
      triggerRefs: props.triggerRefs,
      actions: { onRequestPasswordReset: props.actions.onRequestPasswordReset }
    });
    const settings = container.querySelector('[role="dialog"][aria-labelledby="account-settings-title"]');
    const closeButton = settings.querySelector('button[aria-label="Close account settings"]');
    const cancel = buttonsByText(settings, "Cancel")[0];

    expect(document.activeElement).toBe(closeButton);
    act(() => closeButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true
    })));
    expect(document.activeElement).toBe(cancel);
    act(() => cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(closeButton);

    act(() => closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith("");
    render({
      ambientNavigation: true,
      menu: { openId: "", onOpenChange },
      triggerRefs: props.triggerRefs,
      actions: { onRequestPasswordReset: props.actions.onRequestPasswordReset }
    });
    expect(container.querySelector('[aria-labelledby="account-settings-title"]')).toBeNull();
    expect(document.activeElement).toBe(currentProps.triggerRefs.more.current);
  });

  test("consumes browser or mobile Back by closing Workspace and tools before route traversal", () => {
    const onOpenChange = vi.fn();
    const guards = [];
    const continuation = vi.fn();
    render({
      ambientNavigation: true,
      menu: { openId: "more", onOpenChange },
      actions: {
        onWorkspaceToolsGuardChange: (guard) => guards.push(guard)
      }
    });

    const guard = guards.find((candidate) => candidate?.modelId === "workspace-tools-navigation-guard-v1");
    expect(guard).toMatchObject({ open: true, dirty: false, busy: false });
    expect(guard.requestDismiss("browser_back", continuation)).toEqual({ status: "guarded" });
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(continuation).not.toHaveBeenCalled();

    render({
      ambientNavigation: true,
      menu: { openId: "", onOpenChange },
      actions: {
        onWorkspaceToolsGuardChange: (nextGuard) => guards.push(nextGuard)
      }
    });
    expect(guards.at(-1)).toBeNull();
  });

  test("consumes browser or mobile Back by closing Account settings before route traversal", () => {
    const onOpenChange = vi.fn();
    const guards = [];
    const continuation = vi.fn();
    render({
      ambientNavigation: true,
      menu: { openId: "account-settings", onOpenChange },
      actions: {
        onWorkspaceToolsGuardChange: (guard) => guards.push(guard)
      }
    });

    const guard = guards.find((candidate) => candidate?.modelId === "account-settings-navigation-guard-v1");
    expect(guard).toMatchObject({ open: true, dirty: false, busy: false });
    expect(guard.requestDismiss("browser_back", continuation)).toEqual({ status: "guarded" });
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(continuation).not.toHaveBeenCalled();
  });

  test("dismisses Workspace and tools from the backdrop and opens Search through the stable header trigger", () => {
    const onOpenChange = vi.fn();
    const props = render({
      ambientNavigation: true,
      menu: { openId: "more", onOpenChange }
    });
    const layer = container.querySelector(".workspace-tools-layer");
    const outsidePointerHandler = vi.fn();
    document.addEventListener("pointerdown", outsidePointerHandler);
    act(() => layer.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(outsidePointerHandler).not.toHaveBeenCalled();
    document.removeEventListener("pointerdown", outsidePointerHandler);

    act(() => layer.click());
    expect(onOpenChange).toHaveBeenCalledWith("");

    onOpenChange.mockClear();
    act(() => buttonsByText(layer, "Search customers and opportunities")[0].click());
    expect(onOpenChange).toHaveBeenCalledWith("");
    expect(props.actions.onSearch).toHaveBeenCalledWith(props.triggerRefs.more.current);
  });

  test("defines a thumb-reachable Calm Four bar and safe-area-aware mobile tools sheet", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.app-shell-ambient-navigation[\s\S]*\.ambient-primary-navigation\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*0;/u);
    expect(css).toMatch(/grid-auto-flow:\s*column/u);
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/u);
    expect(css).toMatch(/\.workspace-tools-dialog__actions button\s*\{[\s\S]*min-height:\s*44px/u);
    expect(css).toMatch(/\.workspace-tools-trigger\s*\{[\s\S]*min-width:\s*44px/u);
    expect(css).toMatch(/\.account-settings-layer\s*\{[\s\S]*align-items:\s*center/u);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.account-settings-layer\s*\{[\s\S]*align-items:\s*flex-end/u);
    expect(css).toMatch(/\.account-settings-dialog__reset-action\s*\{[\s\S]*min-height:\s*44px/u);
    expect(css).toMatch(/@media \(min-width:\s*1181px\)[\s\S]*\.app-shell-neutral\.app-shell-ambient-navigation\s*\{[\s\S]*padding-left:\s*236px/u);
    expect(css).toMatch(/\.app-shell-neutral\.app-shell-ambient-navigation \.site-header\s*\{[\s\S]*width:\s*236px/u);
    expect(css).toMatch(/\.header-product-brand \.product-brand-copy\s*\{[\s\S]*display:\s*grid/u);
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
