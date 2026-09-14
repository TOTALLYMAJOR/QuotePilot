import { useEffect, useRef, useState } from "react";
import {
  CalendarBlank,
  ClipboardText,
  EnvelopeSimple,
  MagnifyingGlass,
  NotePencil,
  Plus,
  StarFour,
  UserCircle
} from "./ProductIcons";
import AttentionBadge from "./AttentionBadge";
import ProductBrandLockup from "./ProductBrandLockup";
import { PRODUCT_NAME } from "../lib/productIdentity";
import { AMBIENT_PRIMARY_WORKSPACE_NAVIGATION } from "../lib/workspaceRoutes";

const EMPTY = {};
const HEADER_MENUS = [
  ["operations", "Operations"],
  ["account", "Account"],
  ["more", "More"]
];

const NAV_ICONS = {
  now: CalendarBlank,
  home: CalendarBlank,
  opportunities: NotePencil,
  quotes: NotePencil,
  operations: CalendarBlank,
  events: CalendarBlank,
  clients: UserCircle,
  customers: UserCircle,
  messaging: EnvelopeSimple,
  workflow: NotePencil,
  staff: UserCircle,
  library: StarFour,
  catalog: StarFour
};

const MENU_ICONS = {
  operations: StarFour,
  account: UserCircle,
  more: Plus
};

const WORKSPACE_TOOL_GROUPS = Object.freeze({
  frequent: ["Workflow", "Messages", "Pilot"],
  operations: ["Operations", "Clear the Deck", "Inventory", "Staff"],
  administration: [
    "Reporting Dashboard",
    "Integrations Ops",
    "Import Studio",
    "Session Diagnostics"
  ]
});

const FOCUSABLE_WORKSPACE_TOOL = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const EMPTY_ACCOUNT_SETTINGS_FEEDBACK = Object.freeze({
  phase: "idle",
  message: ""
});

function call(action, ...args) {
  if (typeof action === "function") action(...args);
}

function assignRef(ref, value) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") ref.current = value;
}

/** Presentation only: route, role, tenant-gate, and action truth stay caller-owned. */
export default function WorkspaceShell({
  model = EMPTY,
  identity = EMPTY,
  principal = EMPTY,
  capabilities = EMPTY,
  draftStatus = EMPTY,
  attentionCount = null,
  sounds = EMPTY,
  actions = EMPTY,
  triggerRefs = EMPTY,
  menu = EMPTY,
  searchSurface = null,
  children = null,
  themeVars = EMPTY,
  ambientOpportunity = false,
  ambientNavigation = false
}) {
  const workspace = model.mode === "workspace";
  const ambientOrientation = workspace && ambientNavigation === true;
  const section = model.activeSection || "";
  const isAdmin = principal.isAdmin === true;
  const workspaceName = identity.workspaceName
    || identity.tenantBrandName
    || identity.organizationName
    || "Your catering team";
  const brandName = identity.tenantBrandName || "";
  const tagline = identity.tenantBrandTagline || "";
  const logo = identity.tenantBrandLogoUrl || "";
  const crew = Array.isArray(identity.brandCrew) ? identity.brandCrew : [];
  const openMenu = menu.openId || "";
  const setMenu = (value) => call(menu.onOpenChange, value);
  const close = () => setMenu("");
  const shellRef = useRef(null);
  const workspaceToolsLayerRef = useRef(null);
  const workspaceToolsDialogRef = useRef(null);
  const workspaceToolsActionRef = useRef(false);
  const accountSettingsLayerRef = useRef(null);
  const accountSettingsDialogRef = useRef(null);
  const accountSettingsReturnFocusRef = useRef(null);
  const accountSettingsRequestRef = useRef(0);
  const [workspaceAdministrationOpen, setWorkspaceAdministrationOpen] = useState(false);
  const [accountSettingsFeedback, setAccountSettingsFeedback] = useState(
    EMPTY_ACCOUNT_SETTINGS_FEEDBACK
  );
  const [desktopWorkAreaNewQuote, setDesktopWorkAreaNewQuote] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(min-width: 1181px)").matches
  ));
  const workspaceToolsOpen = ambientOrientation && openMenu === "more";
  const accountSettingsOpen = openMenu === "account-settings";
  const accountSettingsAvailable = typeof actions.onRequestPasswordReset === "function";
  const workspaceAdministrationAvailable = capabilities.reportingDashboard !== false
    || capabilities.integrationsOps !== false
    || isAdmin
    || capabilities.diagnostics !== false;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(min-width: 1181px)");
    const syncPlacement = () => setDesktopWorkAreaNewQuote(query.matches);
    syncPlacement();
    query.addEventListener?.("change", syncPlacement);
    return () => query.removeEventListener?.("change", syncPlacement);
  }, []);
  const closeAccountSettings = () => {
    accountSettingsRequestRef.current += 1;
    setAccountSettingsFeedback(EMPTY_ACCOUNT_SETTINGS_FEEDBACK);
    close();
  };
  const openAccountSettings = (returnFocusTarget) => {
    accountSettingsReturnFocusRef.current = returnFocusTarget || null;
    accountSettingsRequestRef.current += 1;
    setAccountSettingsFeedback(EMPTY_ACCOUNT_SETTINGS_FEEDBACK);
    setMenu("account-settings");
  };
  const requestAccountPasswordReset = async () => {
    if (!accountSettingsAvailable || accountSettingsFeedback.phase === "pending") return;
    const requestId = accountSettingsRequestRef.current + 1;
    accountSettingsRequestRef.current = requestId;
    setAccountSettingsFeedback({
      phase: "pending",
      message: "Requesting a secure password reset email…"
    });
    try {
      await actions.onRequestPasswordReset({ email: principal.email || "" });
      if (accountSettingsRequestRef.current !== requestId) return;
      setAccountSettingsFeedback({
        phase: "success",
        message: `Password reset email requested for ${principal.email || "this account"}.`
      });
    } catch {
      if (accountSettingsRequestRef.current !== requestId) return;
      setAccountSettingsFeedback({
        phase: "error",
        message: "We could not request the reset email. Check your connection and try again."
      });
    }
  };
  const navigate = (action) => {
    close();
    call(action);
  };
  const navButton = (
    label,
    routeSection,
    action,
    ref,
    capability,
    current = true,
    active = model.active?.quoteBuilder !== true || routeSection !== "quotes",
    ambientDestination = ""
  ) => {
    const Icon = NAV_ICONS[ambientDestination || routeSection] || NotePencil;
    return (
      <button
        key={ambientDestination || routeSection}
        type="button"
        className={`ghost shell-nav-action${ambientDestination ? " ambient-orientation-action" : ""}${
          active && section === routeSection ? " nav-view-active" : ""
        }`}
        ref={ref}
        data-capability-entry={capability}
        data-ambient-orientation={ambientDestination || undefined}
        aria-current={current && section === routeSection ? "page" : undefined}
        onClick={() => navigate(action)}
      >
        <Icon className="shell-nav-icon" size={20} weight={active && section === routeSection ? "fill" : "regular"} aria-hidden="true" />
        <span className="shell-nav-label">{label}</span>
      </button>
    );
  };
  const workflowLabel = attentionCount === null
    ? "Workflow"
    : attentionCount > 0
      ? `Workflow, ${attentionCount} ${attentionCount === 1 ? "quote needs" : "quotes need"} attention`
      : "Workflow, no quote follow-ups in this view";
  const menuContent = (
    id,
    { itemRole = "menuitem", showSummary = true, onlyLabels = null } = {}
  ) => {
    const operations = id !== "account";
    const account = id !== "operations";
    const items = [
      [
        ambientOrientation && operations,
        actions.onClearDeck,
        "Clear the Deck",
        false,
        false,
        { capability: "live-operations-planning" }
      ],
      [
        ambientOrientation && operations && capabilities.eventSchedule !== false,
        actions.onOperations,
        "Operations",
        false,
        false,
        { capability: "live-operations-planning" }
      ],
      [
        ambientOrientation && operations,
        actions.onEvents,
        "Events",
        false,
        false,
        { capability: "live-operations-planning" }
      ],
      [
        ambientOrientation && operations,
        actions.onMessages,
        "Messages",
        false,
        false,
        { capability: "event-messaging-station" }
      ],
      [
        ambientOrientation && operations,
        actions.onWorkflow,
        "Workflow",
        false,
        false,
        { ariaLabel: workflowLabel, attention: true }
      ],
      [
        ambientOrientation && operations && typeof actions.onPilot === "function",
        actions.onPilot,
        "Pilot",
        false,
        false,
        { capability: "ambient-pilot-context" }
      ],
      [operations && capabilities.eventSchedule !== false, actions.onSchedule, "Event Schedule", true],
      [
        operations && isAdmin && capabilities.inventoryAuthority === true,
        actions.onInventory,
        "Inventory",
        true,
        false,
        { capability: "inventory-workspace" }
      ],
      [
        operations && isAdmin && capabilities.staffDirectory !== false,
        actions.onStaff,
        "Staff",
        true,
        false,
        { capability: "staff-directory" }
      ],
      [operations && capabilities.reportingDashboard !== false, actions.onReporting, "Reporting Dashboard", true],
      [operations && capabilities.integrationsOps !== false, actions.onIntegrations, "Integrations Ops", true],
      [operations && isAdmin, actions.onImports, "Import Studio", true],
      [operations && isAdmin && !ambientOrientation, actions.onCatalog, "Catalog Admin", true],
      [operations && capabilities.diagnostics !== false, actions.onDiagnostics, "Session Diagnostics", true],
      [account && capabilities.customerPortal !== false, actions.onPortal, "Customer Portal"],
      [account, sounds.onToggle, `Sounds: ${sounds.enabled === true ? "On" : "Off"}`, false, true],
      [account, actions.onSignOut, "Sign Out"]
    ];
    const orderedItems = Array.isArray(onlyLabels)
      ? onlyLabels.map((label) => items.find((item) => item[2] === label)).filter(Boolean)
      : items;
    return <>
      {account && showSummary && <div className="header-account-summary" role="presentation">
        <strong>{principal.email || ""}</strong>
        <span>{principal.role || ""}</span>
      </div>}
      {account && accountSettingsAvailable && (
        <button
          type="button"
          role={itemRole || undefined}
          aria-haspopup="dialog"
          aria-controls="account-settings-dialog"
          onClick={() => openAccountSettings(
            triggerRefs[openMenu]?.current || triggerRefs.account?.current || triggerRefs.more?.current
          )}
        >
          Account settings
        </button>
      )}
      {orderedItems.map(([visible, action, label, operation, sound, item = EMPTY]) => visible && (
        <button
          key={label}
          type="button"
          role={itemRole || undefined}
          data-capability-entry={item.capability}
          aria-label={item.ariaLabel}
          aria-pressed={sound ? sounds.enabled === true : undefined}
          onClick={() => {
            if (!sound) close();
            workspaceToolsActionRef.current = true;
            if (operation) call(action, triggerRefs[openMenu]);
            else call(action);
            workspaceToolsActionRef.current = false;
          }}
        >
          {item.attention ? (
            <><span>{label}</span><AttentionBadge count={attentionCount} /></>
          ) : label}
        </button>
      ))}
    </>;
  };

  useEffect(() => {
    if (!workspaceToolsOpen) setWorkspaceAdministrationOpen(false);
  }, [workspaceToolsOpen]);

  useEffect(() => {
    if (!workspaceToolsOpen) return undefined;
    const shell = shellRef.current;
    const layer = workspaceToolsLayerRef.current;
    const dialog = workspaceToolsDialogRef.current;
    if (!shell || !layer || !dialog) return undefined;

    const background = Array.from(shell.children)
      .filter((element) => element !== layer)
      .map((element) => ({
        element,
        hadInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden")
      }));
    background.forEach(({ element }) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const initialFocus = dialog.querySelector("[data-workspace-tools-initial-focus]")
      || dialog.querySelector(FOCUSABLE_WORKSPACE_TOOL)
      || dialog;
    initialFocus.focus();

    return () => {
      background.forEach(({ element, hadInert, ariaHidden }) => {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      document.documentElement.style.overflow = previousOverflow;
      const trigger = triggerRefs.more?.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [menu.onOpenChange, triggerRefs.more, workspaceToolsOpen]);

  useEffect(() => {
    if (!accountSettingsOpen) return undefined;
    const shell = shellRef.current;
    const layer = accountSettingsLayerRef.current;
    const dialog = accountSettingsDialogRef.current;
    if (!shell || !layer || !dialog) return undefined;

    const background = Array.from(shell.children)
      .filter((element) => element !== layer)
      .map((element) => ({
        element,
        hadInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden")
      }));
    background.forEach(({ element }) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const initialFocus = dialog.querySelector("[data-account-settings-initial-focus]")
      || dialog.querySelector(FOCUSABLE_WORKSPACE_TOOL)
      || dialog;
    initialFocus.focus();

    return () => {
      background.forEach(({ element, hadInert, ariaHidden }) => {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      document.documentElement.style.overflow = previousOverflow;
      const returnTarget = accountSettingsReturnFocusRef.current;
      if (returnTarget && document.contains(returnTarget)) returnTarget.focus();
    };
  }, [accountSettingsOpen]);

  useEffect(() => {
    const onGuardChange = actions.onWorkspaceToolsGuardChange;
    if (typeof onGuardChange !== "function") return undefined;
    if (!workspaceToolsOpen && !accountSettingsOpen) {
      onGuardChange(null);
      return undefined;
    }
    onGuardChange({
      modelId: accountSettingsOpen
        ? "account-settings-navigation-guard-v1"
        : "workspace-tools-navigation-guard-v1",
      open: true,
      dirty: false,
      busy: false,
      requestDismiss: (_reason, continuation = null) => {
        if (accountSettingsOpen) closeAccountSettings();
        else call(menu.onOpenChange, "");
        if (workspaceToolsActionRef.current) return continuation?.();
        // Browser/mobile Back is consumed by this overlay. The history
        // continuation intentionally remains untouched until a later Back.
        return { status: "guarded" };
      }
    });
    return () => onGuardChange(null);
  }, [
    accountSettingsOpen,
    actions.onWorkspaceToolsGuardChange,
    menu.onOpenChange,
    workspaceToolsOpen
  ]);

  const handleWorkspaceToolsKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = workspaceToolsDialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_WORKSPACE_TOOL));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleAccountSettingsKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAccountSettings();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = accountSettingsDialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_WORKSPACE_TOOL));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const workspaceBrandContent = <>
    {logo ? (
      <img className="workspace-brand-logo" src={logo} alt="" loading="eager" decoding="async" />
    ) : (
      <span className="workspace-brand-logo workspace-brand-logo-placeholder" aria-hidden="true">
        {workspaceName.slice(0, 2).toUpperCase()}
      </span>
    )}
    <span className="workspace-brand-copy">
      <small>Today at</small>
      <strong>{workspaceName}</strong>
      {tagline && brandName !== PRODUCT_NAME && <span>{tagline}</span>}
    </span>
  </>;

  const newQuoteAction = (placement = "header") => (
    <button
      className={`cta header-quick-cta${ambientOrientation ? " ambient-utility-action" : ""}${
        placement === "work-area" ? " ambient-workarea-new-quote" : ""
      }`}
      type="button"
      data-ambient-utility={ambientOrientation ? "new-quote" : undefined}
      data-ambient-utility-placement={ambientOrientation ? placement : undefined}
      onClick={() => call(actions.onNewQuote)}
    >
      <Plus className="shell-nav-icon" size={20} weight="bold" aria-hidden="true" />
      <span className="shell-nav-label">New quote</span>
    </button>
  );

  return (
    <div
      ref={shellRef}
      className={`app-shell${workspace ? " app-shell-neutral" : ""}${
        ambientOpportunity ? " app-shell-ambient-opportunity" : ""
      }${
        ambientOrientation ? " app-shell-ambient-navigation" : ""
      }`}
      data-ambient-navigation={ambientOrientation ? "orientation" : undefined}
      style={themeVars}
    >
      <header className="site-header">
        <div className="container nav">
          <div className="workspace-header-identity">
            <ProductBrandLockup compact className="header-product-brand" />
            {ambientOrientation ? (
              <button
                type="button"
                className="workspace-brand workspace-tools-trigger"
                ref={(node) => {
                  assignRef(triggerRefs.more, node);
                  // Pilot now lives inside secondary tools. Its existing modal
                  // still restores focus to this persistent entry point after
                  // the temporary menu item has unmounted.
                  assignRef(triggerRefs.pilot, node);
                }}
                aria-label="Workspace and tools"
                aria-haspopup="dialog"
                aria-controls="workspace-tools-dialog"
                aria-expanded={workspaceToolsOpen}
                onClick={() => setMenu(workspaceToolsOpen ? "" : "more")}
              >
                {workspaceBrandContent}
              </button>
            ) : (
              <div className="workspace-brand" aria-label={`Current workspace: ${workspaceName}`}>
                {workspaceBrandContent}
              </div>
            )}
          </div>

          {crew.length > 0 && (
            <div className="brand-crew">
              {crew.map((member, index) => {
                const label = member?.label || `Team member ${index + 1}`;
                const image = member?.imageUrl || logo;
                return (
                  <figure className="crew-chip" key={index}>
                    {image ? (
                      <img src={image} alt={label} loading="lazy" decoding="async" />
                    ) : (
                      <span className="crew-chip-placeholder" aria-hidden="true">
                        {String(member?.label || "TM").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <figcaption>{label}</figcaption>
                  </figure>
                );
              })}
            </div>
          )}

          <div className="right-actions header-actions" ref={triggerRefs.headerMenus}>
            {workspace && (
              ambientOrientation ? (
                <nav className="ambient-primary-navigation" aria-label="Primary workspace">
                  {AMBIENT_PRIMARY_WORKSPACE_NAVIGATION
                    .filter((destination) => (
                      (!destination.adminOnly || isAdmin)
                      && (!destination.capability || capabilities[destination.capability] !== false)
                    ))
                    .map((destination) => navButton(
                      destination.label,
                      destination.section,
                      actions[destination.action],
                      destination.triggerRef ? triggerRefs[destination.triggerRef] : undefined,
                      undefined,
                      true,
                      true,
                      destination.orientation
                    ))}
                </nav>
              ) : (
                <>
                  {navButton("Now", "home", actions.onHome)}
                  {navButton("Customers", "customers", actions.onCustomers)}
                  <button
                    type="button"
                    className="ghost commercial-search-trigger"
                    ref={triggerRefs.search}
                    aria-haspopup="dialog"
                    aria-keyshortcuts="Meta+K Control+K"
                    aria-label="Search"
                    title="Search customers and quotes (Ctrl or Command K)"
                    onClick={(event) => {
                      close();
                      call(actions.onSearch, event.currentTarget);
                    }}
                  >
                    <MagnifyingGlass className="shell-nav-icon" size={20} aria-hidden="true" />
                    <span className="shell-nav-label">Search</span><kbd aria-hidden="true">⌘K</kbd>
                  </button>
                </>
              )
            )}
            {(!ambientOrientation || !desktopWorkAreaNewQuote) && newQuoteAction("header")}
            {workspace && ambientOrientation && (
              <button
                type="button"
                className="ghost commercial-search-trigger ambient-utility-action ambient-secondary-search"
                ref={triggerRefs.search}
                data-ambient-utility="search"
                aria-haspopup="dialog"
                aria-keyshortcuts="Meta+K Control+K"
                aria-label="Search"
                title="Search customers and quotes (Ctrl or Command K)"
                onClick={(event) => {
                  close();
                  call(actions.onSearch, event.currentTarget);
                }}
              >
                <MagnifyingGlass className="shell-nav-icon" size={20} aria-hidden="true" />
                <span className="shell-nav-label">Search</span><kbd aria-hidden="true">⌘K</kbd>
              </button>
            )}
            {!ambientOrientation && navButton(
              "Quotes",
              "quotes",
              actions.onQuotes,
              triggerRefs.quotes,
              undefined,
              false
            )}
            {/* Canonical capability marker: data-capability-entry="event-messaging-station" */}
            {workspace && !ambientOrientation && navButton(
              "Messages",
              "messaging",
              actions.onMessages,
              undefined,
              "event-messaging-station"
            )}
            {!ambientOrientation && <button
              type="button"
              className={`ghost shell-nav-action workflow-attention-trigger${section === "workflow" ? " nav-view-active" : ""}`}
              ref={triggerRefs.workflow}
              onClick={() => navigate(actions.onWorkflow)}
              aria-label={workflowLabel}
            >
              <ClipboardText className="shell-nav-icon" size={20} aria-hidden="true" />
              <span className="shell-nav-label">Workflow</span><AttentionBadge count={attentionCount} />
            </button>}

            {HEADER_MENUS.filter(() => !ambientOrientation).map(([id, label]) => {
              const mobile = id === "more";
              const open = openMenu === id;
              const MenuIcon = MENU_ICONS[id] || Plus;
              return (
                <div className={`header-menu ${mobile ? "mobile-header-menu" : "desktop-header-menu"}`} key={id}>
                  <button
                    type="button"
                    className="ghost header-menu-trigger"
                    ref={triggerRefs[id]}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setMenu(open ? "" : id)}
                  >
                    <MenuIcon className="shell-nav-icon" size={20} aria-hidden="true" />
                    <span className="shell-nav-label">{label}</span>
                  </button>
                  {open && (
                    <div
                      className={`header-menu-popover${id === "account" ? " account-menu-popover" : ""}${
                        mobile ? " mobile-more-popover" : ""
                      }`}
                      role="menu"
                      aria-label={label}
                    >
                      {menuContent(id)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {ambientOrientation && desktopWorkAreaNewQuote && newQuoteAction("work-area")}

      {workspaceToolsOpen && (
        <div
          className="workspace-tools-layer"
          ref={workspaceToolsLayerRef}
          data-layout-overlap-allowed="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            className="workspace-tools-dialog"
            id="workspace-tools-dialog"
            ref={workspaceToolsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-tools-title"
            aria-describedby="workspace-tools-description"
            tabIndex={-1}
            onKeyDown={handleWorkspaceToolsKeyDown}
          >
            <header className="workspace-tools-dialog__header">
              <div>
                <p className="workspace-tools-dialog__eyebrow">{workspaceName}</p>
                <h2 id="workspace-tools-title">Workspace &amp; tools</h2>
                <p id="workspace-tools-description">Search, operational tools, and account controls.</p>
              </div>
              <button type="button" aria-label="Close workspace and tools" onClick={close}>×</button>
            </header>
            <section
              className="workspace-tools-dialog__section workspace-tools-dialog__workspace"
              data-workspace-tools-group="workspace"
              aria-labelledby="workspace-tools-workspace-title"
            >
              <h3 id="workspace-tools-workspace-title">Current workspace</h3>
              <div
                className="workspace-tools-dialog__workspace-current"
                role="group"
                aria-label={`Current workspace: ${workspaceName}`}
              >
                {logo ? (
                  <img className="workspace-brand-logo" src={logo} alt="" />
                ) : (
                  <span className="workspace-brand-logo workspace-brand-logo-placeholder" aria-hidden="true">
                    {workspaceName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <strong>{workspaceName}</strong>
                <span className="workspace-tools-dialog__current-state">Current</span>
              </div>
              {typeof actions.onSwitchWorkspace === "function" && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    call(actions.onSwitchWorkspace);
                  }}
                >
                  <span>Switch workspace</span>
                </button>
              )}
            </section>
            <section
              className="workspace-tools-dialog__section"
              data-workspace-tools-group="frequent"
              aria-labelledby="workspace-tools-frequent-title"
            >
              <h3 id="workspace-tools-frequent-title">Frequent tools</h3>
              <div className="workspace-tools-dialog__actions">
                <button
                  type="button"
                  data-workspace-tools-initial-focus="true"
                  onClick={(event) => {
                    const returnTarget = triggerRefs.more?.current || event.currentTarget;
                    close();
                    call(actions.onSearch, returnTarget);
                  }}
                >
                  <MagnifyingGlass size={20} aria-hidden="true" />
                  <span>Search customers and opportunities</span>
                </button>
                {menuContent("operations", {
                  itemRole: "",
                  showSummary: false,
                  onlyLabels: WORKSPACE_TOOL_GROUPS.frequent
                })}
              </div>
            </section>
            <section
              className="workspace-tools-dialog__section"
              data-workspace-tools-group="operations"
              aria-labelledby="workspace-tools-operations-title"
            >
              <h3 id="workspace-tools-operations-title">Operations</h3>
              <div className="workspace-tools-dialog__actions">
                {menuContent("operations", {
                  itemRole: "",
                  showSummary: false,
                  onlyLabels: WORKSPACE_TOOL_GROUPS.operations
                })}
              </div>
            </section>
            {workspaceAdministrationAvailable && (
              <section
                className="workspace-tools-dialog__section workspace-tools-dialog__administration"
                data-workspace-tools-group="administration"
                aria-labelledby="workspace-tools-administration-title"
              >
                <div className="workspace-tools-dialog__section-heading">
                  <h3 id="workspace-tools-administration-title">Administration</h3>
                  <button
                    type="button"
                    className="workspace-tools-dialog__disclosure"
                    data-workspace-tools-administration-toggle="true"
                    aria-label={`${workspaceAdministrationOpen ? "Hide" : "Show"} administration tools`}
                    aria-expanded={workspaceAdministrationOpen}
                    aria-controls="workspace-tools-administration-actions"
                    aria-describedby="workspace-tools-administration-description"
                    onClick={() => setWorkspaceAdministrationOpen((open) => !open)}
                  >
                    {workspaceAdministrationOpen ? "Hide" : "Show"}
                  </button>
                </div>
                <p
                  className="workspace-tools-dialog__section-description"
                  id="workspace-tools-administration-description"
                >
                  Reporting, integrations, import, and diagnostics.
                </p>
                {workspaceAdministrationOpen && (
                  <div
                    className="workspace-tools-dialog__actions workspace-tools-dialog__administration-actions"
                    id="workspace-tools-administration-actions"
                  >
                    {menuContent("operations", {
                      itemRole: "",
                      showSummary: false,
                      onlyLabels: WORKSPACE_TOOL_GROUPS.administration
                    })}
                  </div>
                )}
              </section>
            )}
            <section
              className="workspace-tools-dialog__section"
              data-workspace-tools-group="account"
              aria-labelledby="workspace-tools-account-title"
            >
              <h3 id="workspace-tools-account-title">Account</h3>
              <div className="workspace-tools-dialog__identity">
                <small>Signed in as</small>
                <strong>{principal.email || "Signed-in account"}</strong>
                {principal.role && <span>{principal.role}</span>}
              </div>
              <div className="workspace-tools-dialog__actions">
                {menuContent("account", { itemRole: "", showSummary: false })}
              </div>
            </section>
          </section>
        </div>
      )}

      {accountSettingsOpen && (
        <div
          className="workspace-tools-layer account-settings-layer"
          ref={accountSettingsLayerRef}
          data-layout-overlap-allowed="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeAccountSettings();
          }}
        >
          <section
            className="workspace-tools-dialog account-settings-dialog"
            id="account-settings-dialog"
            ref={accountSettingsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-settings-title"
            aria-describedby="account-settings-description"
            aria-busy={accountSettingsFeedback.phase === "pending" ? "true" : undefined}
            tabIndex={-1}
            onKeyDown={handleAccountSettingsKeyDown}
          >
            <header className="workspace-tools-dialog__header">
              <div>
                <p className="workspace-tools-dialog__eyebrow">Account</p>
                <h2 id="account-settings-title">Account settings</h2>
                <p id="account-settings-description">
                  Review this sign-in and request a secure password reset when you need one.
                </p>
              </div>
              <button
                type="button"
                data-account-settings-initial-focus="true"
                aria-label="Close account settings"
                onClick={closeAccountSettings}
              >
                ×
              </button>
            </header>
            <div className="account-settings-dialog__body">
              <section className="account-settings-dialog__identity" aria-labelledby="account-settings-sign-in-title">
                <h3 id="account-settings-sign-in-title">Current sign-in</h3>
                <dl>
                  <div>
                    <dt>Email</dt>
                    <dd>{principal.email || "Signed-in account"}</dd>
                  </div>
                  <div>
                    <dt>Workspace</dt>
                    <dd>{workspaceName}</dd>
                  </div>
                </dl>
              </section>
              <section className="account-settings-dialog__reset" aria-labelledby="account-settings-reset-title">
                <h3 id="account-settings-reset-title">Password</h3>
                <p>
                  QuotePilot will send a reset link to the signed-in email. Nothing changes until that
                  link is completed, and this request does not sign you out.
                </p>
                <button
                  type="button"
                  className="cta account-settings-dialog__reset-action"
                  disabled={
                    !principal.email
                    || accountSettingsFeedback.phase === "pending"
                    || accountSettingsFeedback.phase === "success"
                  }
                  onClick={() => void requestAccountPasswordReset()}
                >
                  {accountSettingsFeedback.phase === "pending"
                    ? "Requesting reset email…"
                    : accountSettingsFeedback.phase === "success"
                      ? "Reset email requested"
                      : "Send password reset email"}
                </button>
                {accountSettingsFeedback.message && (
                  <p
                    className={`account-settings-dialog__feedback is-${accountSettingsFeedback.phase}`}
                    role={accountSettingsFeedback.phase === "error" ? "alert" : "status"}
                    aria-live={accountSettingsFeedback.phase === "error" ? "assertive" : "polite"}
                  >
                    {accountSettingsFeedback.message}
                  </p>
                )}
              </section>
            </div>
            <footer className="account-settings-dialog__footer">
              <button type="button" className="ghost" onClick={closeAccountSettings}>Cancel</button>
            </footer>
          </section>
        </div>
      )}

      {searchSurface && <div data-commercial-search-surface="true">{searchSurface}</div>}

      {(!ambientOrientation || draftStatus.dirty === true || draftStatus.editing === true) && (
        <aside className="workspace-intro container" aria-label="Workspace status">
          <p>
            <strong>
              {ambientOrientation
                ? "Quote status"
                : identity.organizationName || brandName || "Your catering team"}
            </strong>
          </p>
          <p
            className={`workspace-save-state${draftStatus.dirty === true ? " is-dirty" : ""}`}
            aria-live="polite"
          >
            {draftStatus.dirty === true
              ? "Unsaved changes"
              : draftStatus.editing === true
                ? `Editing ${draftStatus.quoteNumber || "saved quote"} · all changes saved`
                : "Workspace open"}
          </p>
        </aside>
      )}
      {children}
    </div>
  );
}
