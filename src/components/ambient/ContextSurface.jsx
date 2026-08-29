import { Children, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./ambient.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function hasContent(content) {
  return Children.toArray(content).some((child) => (
    typeof child !== "string" || child.trim().length > 0
  ));
}

function buildDetailsRegionLabel(title) {
  const normalizedTitle = String(title || "").trim();
  return /\bdetails$/iu.test(normalizedTitle)
    ? normalizedTitle
    : `${normalizedTitle} details`;
}

function scheduleFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame?.(frame);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

function focusableChildren(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => (
    element.getAttribute("aria-hidden") !== "true"
  ));
}

export default function ContextSurface({
  open,
  title,
  onClose,
  children,
  emptyState = null,
  anchorRef = null,
  returnFocusRef = null,
  align = "end",
  description = null,
  reason = null,
  consequence = null,
  collapseArrivalDetails = false,
  footer = null,
  closeLabel = "Close context",
  closeActionId = null,
  closeOnBackdrop = true,
  className = ""
}) {
  const titleId = useId();
  const contextId = useId();
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [anchorStyle, setAnchorStyle] = useState(undefined);
  const resolvedContent = hasContent(children) ? children : emptyState;
  const renderable = Boolean(open && hasContent(title) && hasContent(resolvedContent));

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!renderable || typeof document === "undefined") return undefined;
    previousFocusRef.current = returnFocusRef?.current || document.activeElement;
    const cancelInitialFocus = scheduleFrame(() => {
      const preferred = dialogRef.current?.querySelector("[data-context-initial-focus]");
      const first = preferred || focusableChildren(dialogRef.current)[0] || dialogRef.current;
      first?.focus();
    });

    return () => {
      cancelInitialFocus();
      const returnTarget = returnFocusRef?.current || previousFocusRef.current;
      scheduleFrame(() => {
        if (returnTarget && typeof returnTarget.focus === "function" && returnTarget.isConnected !== false) {
          returnTarget.focus();
        }
      });
    };
  }, [renderable, returnFocusRef]);

  useEffect(() => {
    if (!renderable || typeof document === "undefined") return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.("escape");
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableChildren(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [renderable]);

  useLayoutEffect(() => {
    if (!renderable || typeof window === "undefined") return undefined;

    function positionFromAnchor() {
      const anchor = anchorRef?.current;
      if (!anchor || typeof anchor.getBoundingClientRect !== "function") {
        setAnchorStyle(undefined);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || 0;
      const viewportHeight = document.documentElement?.clientHeight || window.innerHeight || 0;
      const dialogRect = dialogRef.current?.getBoundingClientRect?.();
      const dialogHeight = dialogRect?.height || 0;
      const dialogWidth = dialogRect?.width || Math.min(432, Math.max(0, viewportWidth - 32));
      const preferredTop = rect.bottom + 12;
      const maximumTop = Math.max(16, viewportHeight - dialogHeight - 16);
      const maximumHorizontalOffset = Math.max(16, viewportWidth - dialogWidth - 16);
      const nextStyle = {
        "--ambient-context-anchor-top": `${Math.max(16, Math.min(preferredTop, maximumTop))}px`
      };
      if (align === "start") {
        nextStyle["--ambient-context-anchor-left"] = `${Math.max(16, Math.min(rect.left, maximumHorizontalOffset))}px`;
      } else {
        nextStyle["--ambient-context-anchor-right"] = `${Math.max(16, Math.min(viewportWidth - rect.right, maximumHorizontalOffset))}px`;
      }
      setAnchorStyle(nextStyle);
    }

    positionFromAnchor();
    const resizeObserver = typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(positionFromAnchor)
      : null;
    if (resizeObserver && dialogRef.current) resizeObserver.observe(dialogRef.current);
    window.addEventListener("resize", positionFromAnchor);
    window.addEventListener("scroll", positionFromAnchor, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", positionFromAnchor);
      window.removeEventListener("scroll", positionFromAnchor, true);
    };
  }, [renderable, anchorRef, align]);

  if (!renderable) return null;

  const describedBy = description || (!collapseArrivalDetails && (reason || consequence))
    ? contextId
    : undefined;
  const overlayClassName = [
    "ambient-context-surface",
    "ambient-context-surface--desktop-anchored",
    "ambient-context-surface--mobile-sheet",
    collapseArrivalDetails && "ambient-context-surface--arrival-disclosure",
    `ambient-context-surface--align-${align === "start" ? "start" : "end"}`,
    className
  ].filter(Boolean).join(" ");

  return (
    <div
      className={overlayClassName}
      data-context-variant="anchored-sheet"
      data-layout-overlap-allowed="true"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onCloseRef.current?.("backdrop");
      }}
    >
      <section
        ref={dialogRef}
        className="ambient-context-surface__dialog"
        style={anchorStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <header className="ambient-context-surface__header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="ambient-context-surface__close"
            aria-label={closeLabel}
            onClick={() => onCloseRef.current?.("close")}
            data-ambient-action-id={closeActionId || undefined}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {(description || reason || consequence) && (
          <div id={contextId} className="ambient-context-surface__arrival">
            {description && <p className="ambient-context-surface__description">{description}</p>}
            {collapseArrivalDetails && (reason || consequence) ? (
              <details className="ambient-context-surface__arrival-details">
                <summary>Why this view</summary>
                <div>
                  {reason && (
                    <p><strong>Why this is here</strong><span>{reason}</span></p>
                  )}
                  {consequence && (
                    <p><strong>What this affects</strong><span>{consequence}</span></p>
                  )}
                </div>
              </details>
            ) : (
              <>
                {reason && (
                  <p><strong>Why this is here</strong><span>{reason}</span></p>
                )}
                {consequence && (
                  <p><strong>What this affects</strong><span>{consequence}</span></p>
                )}
              </>
            )}
          </div>
        )}
        <div
          className="ambient-context-surface__body"
          role="region"
          tabIndex={0}
          aria-label={buildDetailsRegionLabel(title)}
        >
          {resolvedContent}
        </div>
        {hasContent(footer) && <footer className="ambient-context-surface__footer">{footer}</footer>}
      </section>
    </div>
  );
}
