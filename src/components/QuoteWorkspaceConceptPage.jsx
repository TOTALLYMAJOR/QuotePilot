import { useMemo, useState } from "react";
import { useCommercialWorkspaceSnapshot } from "../hooks/useCommercialWorkspaceSnapshot";
import {
  buildMessagingPath,
  buildQuoteEditPath,
  buildQuotePath
} from "../lib/workspaceRoutes";
import { buildAmbientLivingOpportunityPresentation } from "./ambientLivingOpportunityPresentation";
import ProductBrandLockup from "./ProductBrandLockup";
import QuoteWorkspaceActivityDrawer from "./QuoteWorkspaceActivityDrawer";
import "./quoteWorkspaceConcept.css";

const CURRENT_QUOTES_PATH = "/app/quotes";

const NAVIGATION_ITEMS = Object.freeze([
  { label: "Home", href: "/app", icon: "home" },
  { label: "Quotes", href: CURRENT_QUOTES_PATH, icon: "document", active: true },
  { label: "Customers", href: "/app/customers", icon: "users" },
  { label: "Catalog", href: "/app/catalog", icon: "catalog" },
  { label: "Templates", href: "/app/catalog", icon: "template" },
  { label: "Reports", href: "/app/reporting", icon: "report" }
]);

const OPERATIONS_ITEMS = Object.freeze([
  { label: "Activity", href: "/app/workflow", icon: "activity" },
  { label: "Settings", href: "/app/integrations", icon: "settings" },
  { label: "Integrations", href: "/app/integrations", icon: "integrations" }
]);

const TABS = Object.freeze(["Event", "Menu", "Services", "Pricing", "Proposal", "Activity"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function firstValue(object, paths) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return null;
}

function firstNumber(object, paths) {
  const value = firstValue(object, paths);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstArray(object, paths) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function formatMoney(value, fallback = "Not recorded") {
  if (typeof value === "string" && value.trim().startsWith("$")) return value.trim();
  const numeric = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(numeric);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
  const source = /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? `${text(value)}T12:00:00` : value;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const parsed = toDate(value);
  if (!parsed) return text(value) || "Date not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    weekday: "long"
  }).format(parsed);
}

function formatActivityTime(value) {
  const parsed = toDate(value);
  if (!parsed) return text(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "Not recorded";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function normalizeMenuItems(quote) {
  const items = firstArray(quote, [
    "menuItems",
    "menu.items",
    "menuSelections",
    "selectedMenuItems",
    "selections.menu",
    "pricing.menuItems"
  ]);

  return items.slice(0, 8).map((item, index) => {
    if (typeof item === "string") {
      return {
        course: String(index + 1),
        name: item,
        detail: "Saved menu selection",
        category: "Menu",
        quantity: "-",
        unitPrice: "-",
        total: "-"
      };
    }
    const quantity = firstNumber(item, ["quantity", "qty", "count", "guestCount"]);
    const unitPrice = firstNumber(item, ["unitPrice", "price", "pricePerPerson", "rate"]);
    const lineTotal = firstNumber(item, ["total", "lineTotal", "extendedPrice", "amount"])
      ?? (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : null);
    return {
      course: text(item.course || item.courseNumber || index + 1),
      name: text(item.name || item.label || item.title || item.menuItemName) || `Menu item ${index + 1}`,
      detail: text(item.description || item.notes || item.detail),
      category: text(item.category || item.section || item.type) || "Menu",
      quantity: Number.isFinite(quantity) ? String(quantity) : "-",
      unitPrice: Number.isFinite(unitPrice) ? formatMoney(unitPrice) : "-",
      total: Number.isFinite(lineTotal) ? formatMoney(lineTotal) : "-"
    };
  });
}

function normalizeActivity(quote, snapshot) {
  const entries = firstArray(quote, ["activity", "history", "auditTrail", "events", "timeline"]);
  if (entries.length) {
    return entries.slice(0, 4).map((entry, index) => ({
      id: text(entry.id || entry.key) || `activity-${index}`,
      label: text(entry.label || entry.title || entry.action || entry.type || entry.description)
        || "Quote activity recorded",
      actor: text(entry.actorName || entry.actor || entry.userName || entry.createdByName),
      time: formatActivityTime(entry.createdAt || entry.timestamp || entry.at || entry.date)
    }));
  }
  return [{
    id: "workspace-loaded",
    label: "Saved quote loaded",
    actor: snapshot.source ? `Source: ${snapshot.source}` : "Tenant quote history",
    time: formatActivityTime(snapshot.loadedAt)
  }];
}

function ConceptIcon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  if (name === "home") {
    return <svg {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>;
  }
  if (name === "users") {
    return <svg {...common}><circle cx="9" cy="8" r="4" /><path d="M2.5 20c.5-4 2.8-6 6.5-6s6 2 6.5 6" /><path d="M16 5.5a3.5 3.5 0 0 1 0 6.8" /><path d="M17 14c2.7.7 4.2 2.7 4.5 6" /></svg>;
  }
  if (name === "catalog" || name === "template") {
    return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" />{name === "template" && <path d="M16 14v4m-2-2h4" />}</svg>;
  }
  if (name === "report") {
    return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 16v-4m5 4V8m5 8v-6" /></svg>;
  }
  if (name === "activity") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z" /></svg>;
  }
  if (name === "integrations") {
    return <svg {...common}><path d="M8 8h8v8H8z" /><path d="M3 12h5m8 0h5M12 3v5m0 8v5" /></svg>;
  }
  if (name === "eye") {
    return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  }
  if (name === "message") {
    return <svg {...common}><path d="M4 4h16v12H8l-4 4V4Z" /><path d="M8 9h8m-8 3h5" /></svg>;
  }
  if (name === "send") {
    return <svg {...common}><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="m22 2-11 11" /></svg>;
  }
  if (name === "calendar") {
    return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></svg>;
  }
  if (name === "clock") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  }
  if (name === "pin") {
    return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  }
  if (name === "check") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  }
  if (name === "alert") {
    return <svg {...common}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg>;
  }
  if (name === "sparkles") {
    return <svg {...common}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" /></svg>;
  }
  if (name === "plus") {
    return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  }
  if (name === "more") {
    return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
  }
  if (name === "back") {
    return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  }
  return <svg {...common}><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4M9 12h6m-6 4h6" /></svg>;
}

function NavigationGroup({ items }) {
  return items.map((item) => (
    <a
      key={item.label}
      className={`qwc-nav-link${item.active ? " qwc-nav-link-active" : ""}`}
      href={item.href}
      aria-current={item.active ? "page" : undefined}
    >
      <ConceptIcon name={item.icon} />
      <span>{item.label}</span>
    </a>
  ));
}

export default function QuoteWorkspaceConceptPage({ authSession, tenantContext, onExit }) {
  const email = String(authSession?.user?.email || "").trim();
  const initials = email
    ? email.split("@")[0].split(/[._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "MY";
  const organizationLabel = String(authSession?.organizationId || tenantContext?.organizationId || "").trim()
    ? "Organization workspace"
    : "My workspace";
  const organizationId = text(authSession?.organizationId || tenantContext?.organizationId);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const snapshot = useCommercialWorkspaceSnapshot({
    enabled: Boolean(organizationId),
    includeHistory: true,
    includeRevenueAttention: false,
    tenantTimeZone: text(
      tenantContext?.organization?.timeZone
      || tenantContext?.organization?.timezone
      || tenantContext?.timeZone
    ),
    organizationId
  });
  const requestedQuoteId = useMemo(
    () => text(new URLSearchParams(window.location.search).get("quoteId")),
    []
  );
  const selectedQuote = useMemo(() => {
    const quotes = Array.isArray(snapshot.quotes) ? snapshot.quotes : [];
    if (requestedQuoteId) {
      return quotes.find((quote) => text(quote?.id || quote?.quoteId) === requestedQuoteId) || null;
    }
    return quotes[0] || null;
  }, [requestedQuoteId, snapshot.quotes]);
  const presentation = useMemo(() => {
    if (!selectedQuote) return null;
    try {
      return buildAmbientLivingOpportunityPresentation(selectedQuote, {
        source: snapshot.source,
        sourceFreshness: snapshot.stale ? "stale" : "fresh",
        role: authSession?.role || tenantContext?.role || "non_staff"
      });
    } catch {
      return null;
    }
  }, [authSession?.role, selectedQuote, snapshot.source, snapshot.stale, tenantContext?.role]);

  const returnToQuotes = () => {
    if (typeof onExit === "function") {
      onExit();
      return;
    }
    window.location.assign(CURRENT_QUOTES_PATH);
  };

  if (!selectedQuote) {
    const exactQuoteUnavailable = Boolean(requestedQuoteId && !snapshot.loading && !snapshot.error);
    return (
      <div className="qwc-shell" data-testid="quote-workspace-concept">
        <main className="qwc-workspace" style={{ gridColumn: "1 / -1", maxWidth: 760, margin: "0 auto", paddingTop: 72 }}>
          <ProductBrandLockup className="qwc-brand" />
          <div className="qwc-preview-boundary">
            <span>{snapshot.loading
              ? "Loading quote"
              : snapshot.error || exactQuoteUnavailable
                ? "Quote unavailable"
                : "No saved quote"}</span>
            <p>{snapshot.loading
              ? "Reading the latest tenant-scoped quote without changing it."
              : snapshot.error
                ? "QuotePilot could not read this tenant's quote history. No data was changed."
                : exactQuoteUnavailable
                  ? "The requested quote is not present in the bounded saved history. No different quote was opened."
                : "Create or save a quote first, then return here to use the new workspace."}</p>
            <button type="button" onClick={snapshot.error ? () => snapshot.refresh({ force: true }) : returnToQuotes}>
              {snapshot.error ? "Retry" : "Open current Quotes"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const identity = presentation?.identity || {};
  const quoteId = text(identity.quoteId || selectedQuote.id || selectedQuote.quoteId);
  const eventName = text(identity.eventName)
    || text(firstValue(selectedQuote, ["eventName", "event.name", "eventDetails.eventName"]))
    || "Untitled event";
  const customerName = text(identity.customerName)
    || text(firstValue(selectedQuote, ["customerName", "customer.name", "contact.name", "clientName"]))
    || "Customer not recorded";
  const quoteNumber = text(identity.quoteNumber)
    || text(firstValue(selectedQuote, ["quoteNumber", "number", "referenceNumber"]))
    || quoteId.slice(0, 8).toUpperCase();
  const venue = text(identity.venue)
    || text(firstValue(selectedQuote, ["venue", "venueName", "event.venue", "eventDetails.venue"]))
    || "Venue not recorded";
  const eventDate = identity.date
    || firstValue(selectedQuote, ["eventDate", "date", "event.date", "eventDetails.date"]);
  const eventTime = text(identity.time)
    || text(firstValue(selectedQuote, ["eventTime", "time", "event.time", "eventDetails.time"]))
    || "Time not recorded";
  const guestCount = presentation?.guestObject?.currentGuestCount
    ?? firstNumber(selectedQuote, ["guestCount", "guests", "event.guestCount", "eventDetails.guestCount"]);
  const eventType = text(firstValue(selectedQuote, ["eventType", "event.type", "eventDetails.eventType", "serviceType"])) || "Event";
  const statusValue = identity?.status?.label
    || identity?.status
    || firstValue(selectedQuote, ["statusLabel", "status", "quoteStatus", "lifecycle.status"])
    || "Status unavailable";
  const menuItems = normalizeMenuItems(selectedQuote);
  const activityItems = normalizeActivity(selectedQuote, snapshot);
  const savedAtValue = firstValue(selectedQuote, ["updatedAt", "updatedAtISO", "savedAt", "modifiedAt"]);
  const totalValue = identity.total
    || firstValue(selectedQuote, ["totals.total", "pricing.total", "grandTotal", "total"]);
  const subtotal = firstNumber(selectedQuote, ["totals.subtotal", "pricing.subtotal", "subtotal"]);
  const serviceFee = firstNumber(selectedQuote, ["totals.serviceFee", "totals.serviceCharge", "pricing.serviceFee", "serviceFee"]);
  const tax = firstNumber(selectedQuote, ["totals.tax", "pricing.tax", "tax", "taxAmount"]);
  const deposit = firstNumber(selectedQuote, ["totals.deposit", "pricing.deposit", "depositAmount", "payment.depositAmount"]);
  const depositPercentRaw = firstNumber(selectedQuote, ["depositPercent", "depositPercentage", "pricing.depositPercent", "payment.depositPercent"]);
  const depositPercent = Number.isFinite(depositPercentRaw)
    ? (Math.abs(depositPercentRaw) <= 1 ? depositPercentRaw * 100 : depositPercentRaw)
    : null;
  const grossProfit = firstNumber(selectedQuote, ["profit.grossProfit", "pricing.grossProfit", "grossProfit", "totals.grossProfit"]);
  const grossMargin = firstNumber(selectedQuote, ["profit.grossMargin", "pricing.grossMargin", "grossMargin", "margin"]);
  const targetMargin = firstNumber(selectedQuote, ["profit.targetMargin", "pricing.targetMargin", "targetMargin"]);
  const completenessChecks = [
    { complete: customerName !== "Customer not recorded", message: "Customer needs attention" },
    { complete: Boolean(eventDate), message: "Event date needs attention" },
    { complete: venue !== "Venue not recorded", message: "Venue needs attention" },
    { complete: Number.isFinite(guestCount) && guestCount > 0, message: "Guest count needs attention" },
    { complete: menuItems.length > 0, message: "Menu needs attention" },
    { complete: totalValue !== null && text(totalValue) !== "", message: "Pricing needs attention" }
  ];
  const attentionItems = completenessChecks.filter((check) => !check.complete).map((check) => check.message);
  const readiness = Math.round((completenessChecks.filter((check) => check.complete).length / completenessChecks.length) * 100);
  const detailPath = quoteId ? buildQuotePath(quoteId) : CURRENT_QUOTES_PATH;
  const editPath = quoteId ? buildQuoteEditPath(quoteId) : CURRENT_QUOTES_PATH;
  const messagePath = quoteId ? buildMessagingPath({ quoteId }) : CURRENT_QUOTES_PATH;
  const go = (path) => window.location.assign(path);
  const tabPath = (tab) => ["Menu", "Services", "Pricing"].includes(tab) ? editPath : detailPath;

  return (
    <div className="qwc-shell" data-testid="quote-workspace-concept">
      <aside className="qwc-sidebar" aria-label="QuotePilot concept navigation">
        <ProductBrandLockup className="qwc-brand" />
        <nav className="qwc-primary-nav" aria-label="Primary">
          <NavigationGroup items={NAVIGATION_ITEMS} />
        </nav>
        <nav className="qwc-operations-nav" aria-label="Operations">
          <NavigationGroup items={OPERATIONS_ITEMS} />
        </nav>
        <div className="qwc-concept-card">
          <span>Connected workspace</span>
          <strong>{quoteNumber}</strong>
          <p>Live tenant data with edits handed back to QuotePilot's existing authority.</p>
          <button type="button" onClick={returnToQuotes}>
            Return to current Quotes
            <ConceptIcon name="back" size={17} />
          </button>
        </div>
        <div className="qwc-user-card">
          <span className="qwc-avatar">{initials || "MY"}</span>
          <span>
            <strong>My Workspace</strong>
            <small>{organizationLabel}</small>
          </span>
        </div>
      </aside>

      <main className="qwc-workspace">
        <header className="qwc-header">
          <div className="qwc-title-block">
            <button type="button" className="qwc-back" onClick={returnToQuotes}>
              <ConceptIcon name="back" size={18} />
              <span>Back to quotes</span>
            </button>
            <div className="qwc-title-line">
              <h1>{quoteNumber} <span aria-hidden="true">-</span> {eventName}</h1>
              <span className="qwc-status">{text(statusValue)}</span>
            </div>
            <p><ConceptIcon name="check" size={16} /> {savedAtValue
              ? `Saved ${formatActivityTime(savedAtValue)}`
              : "Loaded from saved quote history"}</p>
          </div>

          <div className="qwc-header-actions" aria-label="Concept actions">
            <button type="button" className="qwc-button qwc-button-quiet" onClick={() => go(detailPath)}>
              <ConceptIcon name="eye" size={18} /> Preview
            </button>
            <button type="button" className="qwc-button qwc-button-quiet" onClick={() => go(messagePath)}>
              <ConceptIcon name="message" size={18} /> Send message
            </button>
            <button type="button" className="qwc-button qwc-button-primary" onClick={() => go(detailPath)}>
              <ConceptIcon name="send" size={18} /> Review &amp; send
            </button>
            <button type="button" className="qwc-icon-button" aria-label="Edit quote" onClick={() => go(editPath)}>
              <ConceptIcon name="more" />
            </button>
          </div>
        </header>

        <nav className="qwc-tabs" aria-label="Quote sections">
          {TABS.map((tab) => {
            const isActivityTab = tab === "Activity";
            const isActive = isActivityTab ? activityDrawerOpen : tab === "Event" && !activityDrawerOpen;
            return (
              <button
                key={tab}
                type="button"
                className={isActive ? "qwc-tab-active" : ""}
                onClick={() => {
                  if (isActivityTab) {
                    setActivityDrawerOpen(true);
                    return;
                  }
                  if (tab !== "Event") go(tabPath(tab));
                }}
                title={tab === "Event"
                  ? "Current workspace section"
                  : isActivityTab
                    ? "Open activity and save health"
                    : `Open ${tab} in the authoritative quote workspace`}
                aria-expanded={isActivityTab ? activityDrawerOpen : undefined}
                aria-controls={isActivityTab ? "qwc-activity-save-drawer" : undefined}
              >
                {tab}
              </button>
            );
          })}
        </nav>

        <div className="qwc-preview-boundary">
          <span>Connected preview</span>
          <p>Showing saved tenant data. Readiness is completeness, not approval; all changes continue in the authoritative quote workspace.</p>
          <button type="button" onClick={() => snapshot.refresh({ force: true })}>Refresh data</button>
        </div>

        {snapshot.error && (
          <div className="qwc-notice" role="status" aria-live="polite">
            <ConceptIcon name="alert" size={18} />
            <span>This view is showing the last available quote data. Refresh before making a time-sensitive decision.</span>
            <button type="button" onClick={() => snapshot.refresh({ force: true })}>Refresh</button>
          </div>
        )}

        <div className="qwc-layout">
          <div className="qwc-main-column">
            <section className="qwc-event-overview" aria-labelledby="qwc-event-title">
              <img
                className="qwc-event-image"
                src="/images/quote-workspace-wedding-table-v1.webp"
                alt="Editorial view of a catered event table"
              />
              <div className="qwc-event-facts">
                <p className="qwc-eyebrow">Event at a glance</p>
                <h2 id="qwc-event-title">{eventName}</h2>
                <dl>
                  <div><dt><ConceptIcon name="calendar" /></dt><dd>{formatDate(eventDate)}</dd></div>
                  <div><dt><ConceptIcon name="clock" /></dt><dd>{eventTime}</dd></div>
                  <div><dt><ConceptIcon name="pin" /></dt><dd>{venue}</dd></div>
                  <div><dt><ConceptIcon name="users" /></dt><dd>{Number.isFinite(guestCount) ? `${guestCount} guests` : "Guest count not recorded"}</dd></div>
                </dl>
                <span className="qwc-event-type">{eventType}</span>
              </div>
              <div className="qwc-readiness">
                <p className="qwc-eyebrow">Quote readiness</p>
                <div className="qwc-readiness-content">
                  <div
                    className="qwc-readiness-ring"
                    aria-label={`Quote readiness ${readiness} percent`}
                    style={{ background: `conic-gradient(#c79a42 0 ${readiness * 3.6}deg, #e7e3dc ${readiness * 3.6}deg 360deg)` }}
                  ><span>{readiness}%</span></div>
                  <div className="qwc-readiness-copy">
                    <strong>{attentionItems.length ? `${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"} need attention` : "Core details are present"}</strong>
                    <ul>
                      {(attentionItems.length ? attentionItems.slice(0, 3) : ["Ready for human review"]).map((item) => (
                        <li key={item}><ConceptIcon name={attentionItems.length ? "alert" : "check"} size={15} /> {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="qwc-pricing-good"><ConceptIcon name="check" size={18} /> Completeness never changes approval status</p>
              </div>
            </section>

            <section className="qwc-menu" aria-labelledby="qwc-menu-title">
              <div className="qwc-section-heading">
                <h2 id="qwc-menu-title">Menu items</h2>
                <div>
                  <button type="button" onClick={() => go(editPath)}><ConceptIcon name="plus" size={18} /> Add item</button>
                  <button type="button" onClick={() => go(editPath)}>Add package</button>
                  <button type="button" className="qwc-small-icon" aria-label="Open quote editor" onClick={() => go(editPath)}><ConceptIcon name="more" size={18} /></button>
                </div>
              </div>
              <div className="qwc-menu-head" aria-hidden="true">
                <span>Item</span><span>Category</span><span>Qty</span><span>Unit price</span><span>Total</span><span />
              </div>
              <div className="qwc-menu-body">
                {menuItems.map((item) => (
                  <article className="qwc-menu-row" key={item.name}>
                    <div className="qwc-menu-item">
                      <span className="qwc-course">{item.course}</span>
                      <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                    </div>
                    <span className="qwc-menu-category">{item.category}</span>
                    <span className="qwc-menu-quantity">{item.quantity}</span>
                    <span className="qwc-menu-unit">{item.unitPrice}</span>
                    <span className="qwc-menu-total">{item.total}</span>
                    <button type="button" aria-label={`Edit ${item.name}`} onClick={() => go(editPath)}><ConceptIcon name="more" size={18} /></button>
                  </article>
                ))}
                {!menuItems.length && (
                  <article className="qwc-menu-row">
                    <div className="qwc-menu-item"><span className="qwc-course">-</span><span><strong>No saved menu items found</strong><small>Open the quote editor to add or review selections.</small></span></div>
                  </article>
                )}
              </div>
              <button type="button" className="qwc-add-row" onClick={() => go(editPath)}><ConceptIcon name="plus" size={18} /> Add item in quote editor</button>
            </section>

            <div className="qwc-lower-grid">
              <section className="qwc-notes" aria-labelledby="qwc-notes-title">
                <div className="qwc-mini-tabs">
                  <h2 id="qwc-notes-title">Notes</h2>
                  <button type="button" className="qwc-mini-tab-active">Internal note</button>
                  <button type="button" disabled>Client note</button>
                </div>
                <button type="button" className="qwc-empty-action" onClick={() => go(editPath)}>Open the quote editor to view or add notes</button>
              </section>
              <section className="qwc-attachments" aria-labelledby="qwc-attachments-title">
                <div className="qwc-section-heading qwc-section-heading-compact">
                  <h2 id="qwc-attachments-title">Attachments</h2>
                  <button type="button" onClick={() => go(editPath)}><ConceptIcon name="plus" size={18} /> Add</button>
                </div>
                <div className="qwc-file-row">
                  <span className="qwc-file-icon">FILE</span>
                  <span><strong>Manage quote attachments</strong><small>Open the authoritative quote editor</small></span>
                  <ConceptIcon name="more" size={18} />
                </div>
              </section>
            </div>
          </div>

          <aside className="qwc-side-column" aria-label="Quote consequences">
            <section className="qwc-side-panel qwc-summary" aria-labelledby="qwc-summary-title">
              <h2 id="qwc-summary-title">Quote summary</h2>
              <dl>
                <div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
                <div><dt>Service fee</dt><dd>{formatMoney(serviceFee)}</dd></div>
                <div><dt>Tax</dt><dd>{formatMoney(tax)}</dd></div>
              </dl>
              <div className="qwc-total"><span>Total</span><strong>{formatMoney(totalValue)}</strong></div>
              <div className="qwc-deposit"><span>Deposit{Number.isFinite(depositPercent) ? ` (${depositPercent.toFixed(0)}%)` : ""}</span><strong>{formatMoney(deposit)}</strong></div>
              <button type="button" onClick={() => go(editPath)}>View pricing breakdown</button>
            </section>

            <section className="qwc-side-panel qwc-profit" aria-labelledby="qwc-profit-title">
              <h2 id="qwc-profit-title">Profit insights</h2>
              <dl>
                <div><dt>Gross profit</dt><dd>{formatMoney(grossProfit)}</dd></div>
                <div><dt>Gross margin</dt><dd className={Number.isFinite(grossMargin) ? "qwc-success-text" : ""}>{formatPercent(grossMargin)}</dd></div>
                <div><dt>Target margin</dt><dd>{formatPercent(targetMargin)}</dd></div>
              </dl>
              <p><ConceptIcon name={Number.isFinite(grossMargin) ? "check" : "alert"} size={18} /> {Number.isFinite(grossMargin) ? "Margin is recorded on this quote." : "Margin evidence is not available in this summary."}</p>
            </section>

            <section className="qwc-side-panel qwc-activity" aria-labelledby="qwc-activity-title">
              <h2 id="qwc-activity-title">Recent activity</h2>
              <ol>
                {activityItems.map((item) => (
                  <li key={item.id}><span className="qwc-timeline-dot" /><span><strong>{item.label}</strong><small>{item.actor}</small></span><time>{item.time}</time></li>
                ))}
              </ol>
              <button
                type="button"
                className="qwc-ask qwc-activity-open"
                onClick={() => setActivityDrawerOpen(true)}
                aria-expanded={activityDrawerOpen}
                aria-controls="qwc-activity-save-drawer"
              >
                <ConceptIcon name="activity" />
                <span>Activity &amp; save health</span>
                {attentionItems.length ? <span className="qwc-activity-open-count">{attentionItems.length}</span> : null}
              </button>
            </section>
          </aside>
        </div>
      </main>

      <QuoteWorkspaceActivityDrawer
        open={activityDrawerOpen}
        onClose={() => setActivityDrawerOpen(false)}
        quoteNumber={quoteNumber}
        quoteStatus={text(statusValue)}
        activityItems={activityItems}
        checks={completenessChecks}
        lastSavedLabel={savedAtValue ? formatActivityTime(savedAtValue) : "Timestamp not recorded"}
        source={snapshot.source}
        stale={Boolean(snapshot.stale)}
        readError={Boolean(snapshot.error)}
        refreshing={Boolean(snapshot.loading)}
        onRefresh={() => snapshot.refresh({ force: true })}
        onOpenEditor={() => go(editPath)}
      />

      <div className="qwc-mobile-actions" aria-label="Mobile quote actions">
        <div><span>Total</span><strong>{formatMoney(totalValue)}</strong></div>
        <div><span>Deposit{Number.isFinite(depositPercent) ? ` (${depositPercent.toFixed(0)}%)` : ""}</span><strong>{formatMoney(deposit)}</strong></div>
        <button type="button" onClick={() => go(detailPath)}><ConceptIcon name="eye" /> Preview quote</button>
      </div>
    </div>
  );
}
