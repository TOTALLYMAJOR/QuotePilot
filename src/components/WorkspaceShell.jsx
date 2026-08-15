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

function call(action, ...args) {
  if (typeof action === "function") action(...args);
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
  const menuContent = (id) => {
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
        ambientOrientation && operations,
        actions.onOperations,
        "Operations switchboard",
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
      [operations && capabilities.eventSchedule !== false, actions.onSchedule, "Event Schedule", true],
      [
        operations && isAdmin && capabilities.staffDirectory !== false && !ambientOrientation,
        actions.onStaff,
        "Staff",
        true
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
    return <>
      {account && <div className="header-account-summary" role="presentation">
        <strong>{principal.email || ""}</strong>
        <span>{principal.role || ""}</span>
      </div>}
      {items.map(([visible, action, label, operation, sound, item = EMPTY]) => visible && (
        <button
          key={label}
          type="button"
          role="menuitem"
          data-capability-entry={item.capability}
          aria-label={item.ariaLabel}
          aria-pressed={sound ? sounds.enabled === true : undefined}
          onClick={() => {
            if (!sound) close();
            if (operation) call(action, triggerRefs[openMenu]);
            else call(action);
          }}
        >
          {item.attention ? (
            <><span>{label}</span><AttentionBadge count={attentionCount} /></>
          ) : label}
        </button>
      ))}
    </>;
  };

  return (
    <div
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
            <div className="workspace-brand" aria-label={`Current workspace: ${workspaceName}`}>
              {logo ? (
                <img className="workspace-brand-logo" src={logo} alt="" loading="eager" decoding="async" />
              ) : (
                <span className="workspace-brand-logo workspace-brand-logo-placeholder" aria-hidden="true">
                  {workspaceName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="workspace-brand-copy">
                <small>Today at</small>
                <strong>{workspaceName}</strong>
                {tagline && brandName !== PRODUCT_NAME && <span>{tagline}</span>}
              </div>
            </div>
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
                <>
                  {navButton("Now", "home", actions.onHome, undefined, undefined, true, true, "now")}
                  {navButton(
                    "Opportunities",
                    "quotes",
                    actions.onQuotes,
                    triggerRefs.quotes,
                    undefined,
                    true,
                    true,
                    "opportunities"
                  )}
                  {navButton(
                    "Events",
                    "events",
                    actions.onEvents,
                    undefined,
                    "live-operations-planning",
                    true,
                    true,
                    "events"
                  )}
                  {navButton(
                    "Clients",
                    "customers",
                    actions.onCustomers,
                    undefined,
                    undefined,
                    true,
                    true,
                    "clients"
                  )}
                  {isAdmin && capabilities.staffDirectory !== false && navButton(
                    "Staff",
                    "staff",
                    actions.onStaff,
                    undefined,
                    "staff-directory",
                    true,
                    true,
                    "staff"
                  )}
                  {isAdmin && navButton(
                    "Library",
                    "catalog",
                    actions.onCatalog,
                    undefined,
                    undefined,
                    true,
                    true,
                    "library"
                  )}
                  <button
                    type="button"
                    className="ghost commercial-search-trigger ambient-utility-action"
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
                </>
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
            <button
              className={`cta header-quick-cta${ambientOrientation ? " ambient-utility-action" : ""}`}
              type="button"
              data-ambient-utility={ambientOrientation ? "new-quote" : undefined}
              onClick={() => call(actions.onNewQuote)}
            >
              <Plus className="shell-nav-icon" size={20} weight="bold" aria-hidden="true" />
              <span className="shell-nav-label">New quote</span>
            </button>
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

            {HEADER_MENUS.map(([id, label]) => {
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
            {ambientOrientation && (
              <button
                type="button"
                className="ghost ambient-global-pilot-trigger"
                ref={triggerRefs.pilot}
                data-ambient-utility="pilot"
                data-ambient-action-id="open-global-pilot-context"
                aria-label="Open Pilot for the current context"
                onClick={() => {
                  close();
                  call(actions.onPilot);
                }}
              >
                <StarFour className="ambient-global-pilot-mark shell-nav-icon" size={20} weight="fill" aria-hidden="true" />
                <span className="shell-nav-label">Pilot</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {searchSurface && <div data-commercial-search-surface="true">{searchSurface}</div>}

      <aside className="workspace-intro container" aria-label="Workspace status">
        <p><strong>{identity.organizationName || brandName || "Your catering team"}</strong></p>
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
      {children}
    </div>
  );
}
