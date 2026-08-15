import {
  CalendarBlank,
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
  home: CalendarBlank,
  customers: UserCircle,
  quotes: NotePencil,
  messaging: EnvelopeSimple
};

const MENU_ICONS = {
  operations: StarFour,
  account: UserCircle,
  more: Plus
};

function call(action, ...args) {
  if (typeof action === "function") action(...args);
}

// Exact flag-off workspace orientation. Keeping this in a separate build-time
// module prevents Ambient navigation and Pilot chrome from entering the
// rollback bundle while preserving the shared shell authority boundaries.
export default function LegacyWorkspaceShell({
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
  themeVars = EMPTY
}) {
  const workspace = model.mode === "workspace";
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
    active = model.active?.quoteBuilder !== true || routeSection !== "quotes"
  ) => {
    const Icon = NAV_ICONS[routeSection] || NotePencil;
    return (
      <button
        type="button"
        className={`ghost shell-nav-action${active && section === routeSection ? " nav-view-active" : ""}`}
        ref={ref}
        data-capability-entry={capability}
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
      [operations && capabilities.eventSchedule !== false, actions.onSchedule, "Event Schedule", true],
      [operations && capabilities.reportingDashboard !== false, actions.onReporting, "Reporting Dashboard", true],
      [operations && capabilities.integrationsOps !== false, actions.onIntegrations, "Integrations Ops", true],
      [operations && isAdmin, actions.onImports, "Import Studio", true],
      [operations && isAdmin, actions.onCatalog, "Catalog Admin", true],
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
      {items.map(([visible, action, label, operation, sound]) => visible && (
        <button
          key={label}
          type="button"
          role="menuitem"
          aria-pressed={sound ? sounds.enabled === true : undefined}
          onClick={() => {
            if (!sound) close();
            if (operation) call(action, triggerRefs[openMenu]);
            else call(action);
          }}
        >
          {label}
        </button>
      ))}
    </>;
  };

  return (
    <div className={`app-shell${workspace ? " app-shell-neutral" : ""}`} style={themeVars}>
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
            )}
            <button className="cta header-quick-cta" type="button" onClick={() => call(actions.onNewQuote)}>
              <Plus className="shell-nav-icon" size={20} weight="bold" aria-hidden="true" />
              <span className="shell-nav-label">New quote</span>
            </button>
            {navButton("Quotes", "quotes", actions.onQuotes, triggerRefs.quotes, undefined, false)}
            {workspace && navButton(
              "Messages",
              "messaging",
              actions.onMessages,
              undefined,
              "event-messaging-station"
            )}
            <button
              type="button"
              className={`ghost shell-nav-action workflow-attention-trigger${section === "workflow" ? " nav-view-active" : ""}`}
              ref={triggerRefs.workflow}
              onClick={() => navigate(actions.onWorkflow)}
              aria-label={workflowLabel}
            >
              <ClipboardText className="shell-nav-icon" size={20} aria-hidden="true" />
              <span className="shell-nav-label">Workflow</span><AttentionBadge count={attentionCount} />
            </button>

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
