import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./quoteWorkspaceActivityDrawer.css";

const DRAWER_ID = "qwc-activity-save-drawer";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function cleanText(value, fallback = "Not recorded") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function DrawerIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  if (name === "close") {
    return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>;
  }
  if (name === "refresh") {
    return <svg {...common}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.2A7 7 0 0 1 18.7 7M17.9 15.8A7 7 0 0 1 5.3 17" /></svg>;
  }
  if (name === "arrow") {
    return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
  }
  if (name === "check") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  }
  return <svg {...common}><path d="M12 8v5" /><path d="M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></svg>;
}

export default function QuoteWorkspaceActivityDrawer({
  open,
  onClose,
  quoteNumber,
  quoteStatus,
  activityItems = [],
  checks = [],
  lastSavedLabel,
  source,
  stale = false,
  readError = false,
  refreshing = false,
  onRefresh,
  onOpenEditor
}) {
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const visibleGaps = checks.filter((check) => !check?.complete);
  const health = readError
    ? {
        tone: "warning",
        label: "Saved data needs a refresh",
        detail: "The latest read did not complete. This panel is showing only the last available saved evidence."
      }
    : stale
      ? {
          tone: "warning",
          label: "Saved view may be stale",
          detail: "Refresh before relying on this quote for a time-sensitive decision."
        }
      : {
          tone: "clear",
          label: "Saved version loaded",
          detail: "No draft changes are created in this read-only workspace. Editing and saving continue in the quote editor."
        };

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="qwad-root" data-testid="quote-workspace-activity-drawer">
      <button
        type="button"
        className="qwad-scrim"
        aria-label="Close activity and save health"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className="qwad-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qwad-title"
        aria-describedby="qwad-description"
      >
        <header className="qwad-header">
          <div>
            <p className="qwad-eyebrow">Quote control</p>
            <h2 id="qwad-title">Activity &amp; save health</h2>
            <p id="qwad-description">{cleanText(quoteNumber, "Current quote")} · evidence before action</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="qwad-close"
            aria-label="Close activity and save health"
            onClick={onClose}
          >
            <DrawerIcon name="close" />
          </button>
        </header>

        <div className="qwad-body">
          <section className={`qwad-health qwad-health-${health.tone}`} aria-labelledby="qwad-health-title">
            <div className="qwad-section-title">
              <div>
                <p className="qwad-eyebrow">Save health</p>
                <h3 id="qwad-health-title">{health.label}</h3>
              </div>
              <span className="qwad-health-mark" aria-hidden="true"><DrawerIcon name={health.tone === "clear" ? "check" : "alert"} /></span>
            </div>
            <p>{health.detail}</p>
            <dl className="qwad-evidence-grid">
              <div><dt>Last saved</dt><dd>{cleanText(lastSavedLabel)}</dd></div>
              <div><dt>Saved source</dt><dd>{cleanText(source, "Tenant quote history")}</dd></div>
              <div><dt>Quote status</dt><dd>{cleanText(quoteStatus)}</dd></div>
            </dl>
            <p className="qwad-boundary">Save evidence and lifecycle status are separate. This panel never saves, sends, or approves a quote.</p>
          </section>

          <section className="qwad-section" aria-labelledby="qwad-gaps-title">
            <div className="qwad-section-title">
              <div>
                <p className="qwad-eyebrow">Before the next save</p>
                <h3 id="qwad-gaps-title">Visible attention</h3>
              </div>
              <span className="qwad-count" aria-label={`${visibleGaps.length} visible items`}>{visibleGaps.length}</span>
            </div>

            {visibleGaps.length ? (
              <ol className="qwad-gap-list">
                {visibleGaps.map((check, index) => (
                  <li key={check.id || check.message || index}>
                    <span className="qwad-gap-number">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{cleanText(check.message, "Quote detail needs attention")}</strong>
                      <p>Resolve this in the authoritative quote editor before relying on the next saved version.</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="qwad-clear-state">
                <DrawerIcon name="check" />
                <div><strong>No visible completeness gaps</strong><p>This is not a save guarantee.</p></div>
              </div>
            )}

            <p className="qwad-boundary">Final save checks still include server validation, availability, pricing authority, permissions, and version conflicts.</p>
            <button type="button" className="qwad-primary" onClick={onOpenEditor}>
              Open quote editor <DrawerIcon name="arrow" />
            </button>
          </section>

          <section className="qwad-section" aria-labelledby="qwad-activity-title">
            <div className="qwad-section-title">
              <div>
                <p className="qwad-eyebrow">Saved history</p>
                <h3 id="qwad-activity-title">Recent activity</h3>
              </div>
              <span className="qwad-count" aria-label={`${activityItems.length} activity items`}>{activityItems.length}</span>
            </div>
            <ol className="qwad-activity-list">
              {activityItems.map((item) => (
                <li key={item.id}>
                  <span className="qwad-timeline-mark" aria-hidden="true" />
                  <div><strong>{cleanText(item.label, "Quote activity recorded")}</strong><small>{cleanText(item.actor, "Saved quote history")}</small></div>
                  <time>{cleanText(item.time, "Time not recorded")}</time>
                </li>
              ))}
            </ol>
            <p className="qwad-boundary">Unsaved session changes are not part of persisted history and are not represented here.</p>
          </section>
        </div>

        <footer className="qwad-footer">
          <button type="button" className="qwad-secondary" onClick={onRefresh} disabled={refreshing}>
            <DrawerIcon name="refresh" /> {refreshing ? "Refreshing..." : "Refresh saved data"}
          </button>
          <button type="button" className="qwad-text-button" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </div>,
    document.body
  );
}
