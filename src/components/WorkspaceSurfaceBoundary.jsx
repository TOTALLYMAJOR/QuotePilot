import { Suspense, useEffect, useId, useState } from "react";
import {
  LazySurfaceLoading,
  RecoverableErrorBoundary
} from "./RecoverableErrorBoundary";
import { WORKSPACE_PATHS } from "../lib/workspaceRoutes";

export function useStickyMount(active) {
  const [hasMounted, setHasMounted] = useState(Boolean(active));

  useEffect(() => {
    if (active) setHasMounted(true);
  }, [active]);

  return Boolean(active) || hasMounted;
}

export function WorkspaceSectionLoading({
  label,
  rows = 2,
  className = ""
}) {
  const rowCount = Math.min(4, Math.max(1, Number(rows) || 1));

  return (
    <div
      className={`workspace-section-loading ${className}`.trim()}
      data-workspace-section-loading="true"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="source-note">{label}</p>
      <div className="workspace-section-loading__rows" aria-hidden="true">
        {Array.from({ length: rowCount }, (_, index) => (
          <span
            key={index}
            className="workspace-loading-row"
            data-workspace-loading-row="true"
          />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceRouteLoading({ surfaceName }) {
  const titleId = `workspace-route-loading-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <main
      className="container workspace-route-main workspace-route-loading qp-route-loading"
      aria-labelledby={titleId}
      data-workspace-route-loading="true"
    >
      <section
        className="panel workspace-route-loading__panel"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <header className="workspace-route-head workspace-route-loading__head">
          <div>
            <p className="eyebrow">{surfaceName}</p>
            <h1 id={titleId} className="workspace-route-heading">Loading {surfaceName}</h1>
            <p className="source-note">Preparing this workspace…</p>
          </div>
        </header>
        <div className="workspace-route-loading__grid" aria-hidden="true">
          <div
            className="workspace-route-loading__block workspace-route-loading__block--primary"
            data-workspace-loading-slot="primary"
          >
            <span className="workspace-loading-row" />
            <span className="workspace-loading-row" />
            <span className="workspace-loading-row" />
          </div>
          <div
            className="workspace-route-loading__block workspace-route-loading__block--supplemental"
            data-workspace-loading-slot="supplemental"
          >
            <span className="workspace-loading-row" />
            <span className="workspace-loading-row" />
          </div>
        </div>
      </section>
    </main>
  );
}

export function WorkspaceLazyTool({
  open,
  surfaceName,
  component: LazyComponent,
  onClose,
  returnFocusRef,
  hasUnsavedWorkspaceChanges = false,
  children
}) {
  return (
    <RecoverableErrorBoundary
      active={open}
      surfaceName={surfaceName}
      surfaceKind="tool"
      onRetry={LazyComponent.retry}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      hasUnsavedWorkspaceChanges={hasUnsavedWorkspaceChanges}
    >
      <Suspense
        fallback={open ? (
          <LazySurfaceLoading
            surfaceName={surfaceName}
            onClose={onClose}
            returnFocusRef={returnFocusRef}
          />
        ) : null}
      >
        {children}
      </Suspense>
    </RecoverableErrorBoundary>
  );
}

export function WorkspaceLazyRoute({
  active = true,
  surfaceName,
  component: LazyComponent,
  onClose = () => window.location.assign(WORKSPACE_PATHS.home),
  children
}) {
  return (
    <RecoverableErrorBoundary
      active={active}
      surfaceName={surfaceName}
      surfaceKind="route"
      onRetry={LazyComponent.retry}
      onClose={onClose}
    >
      <Suspense
        fallback={active
          ? <WorkspaceRouteLoading surfaceName={surfaceName} />
          : null}
      >
        {children}
      </Suspense>
    </RecoverableErrorBoundary>
  );
}

export function WorkspaceToolSurface({
  mounted,
  open,
  presentation,
  surfaceName,
  component: Surface,
  onClose,
  returnFocusRef,
  hasUnsavedWorkspaceChanges = false,
  surfaceProps,
  presentationProps
}) {
  if (!mounted) return null;

  if (presentation === "modal") {
    return (
      <WorkspaceLazyTool
        open={open}
        surfaceName={surfaceName}
        component={Surface}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
        hasUnsavedWorkspaceChanges={hasUnsavedWorkspaceChanges}
      >
        <Surface
          {...surfaceProps}
          {...presentationProps}
          open={open}
          presentation="modal"
          onClose={onClose}
          returnFocusRef={returnFocusRef}
        />
      </WorkspaceLazyTool>
    );
  }

  return (
    <div
      className="workspace-tool-route-surface"
      data-workspace-tool-surface={surfaceName}
      data-workspace-tool-open={open ? "true" : "false"}
      hidden={!open}
      aria-hidden={open ? undefined : "true"}
      style={open ? { display: "contents" } : undefined}
    >
      <WorkspaceLazyRoute
        active={open}
        surfaceName={surfaceName}
        component={Surface}
        onClose={onClose}
      >
        <Surface {...surfaceProps} {...presentationProps} open={open} onClose={onClose} />
      </WorkspaceLazyRoute>
    </div>
  );
}

export function buildWorkspaceArrivalNoticePresentation(context, resolution = null) {
  const status = resolution?.status === "resolved"
    ? "resolved"
    : resolution?.status === "recovery"
      ? "recovery"
      : "pending";
  if (!context && status !== "recovery") return null;
  const objectLabel = String(context?.object?.label || "requested item").trim();

  if (status === "resolved") {
    return {
      status,
      title: `${objectLabel} ready`,
      reason: context.reason,
      consequence: context.consequence,
      nextResolution: context.nextResolution
    };
  }

  if (status === "recovery") {
    return {
      status,
      title: `${objectLabel} unavailable`,
      reason: resolution?.reason
        || "The exact requested item is not available in the current destination evidence.",
      consequence: resolution?.consequence
        || "No alternate item was selected, so work remains attached to the original context.",
      nextResolution: resolution?.nextResolution
        || "Return to the originating opportunity and reopen this exact action."
    };
  }

  return {
    status,
    title: `Finding ${objectLabel}`,
    reason: context.reason,
    consequence: "QuotePilot is locating the exact requested item; it will not substitute another item.",
    nextResolution: context.nextResolution
  };
}

export function WorkspaceArrivalNotice({ context, resolution = null, fallbackSurfaceId = "workspace" }) {
  const presentation = buildWorkspaceArrivalNoticePresentation(context, resolution);
  if (!presentation) return null;
  const surfaceId = context?.surfaceId || fallbackSurfaceId;
  return (
    <section
      className="workspace-arrival-context source-note"
      data-surface-purpose="reveal_context resolve"
      data-arrival-surface={surfaceId}
      data-arrival-state={presentation.status}
      role="status"
      aria-live="polite"
    >
      <strong>{presentation.title}</strong>
      <span>{presentation.reason}</span>
      <span>{presentation.consequence}</span>
      <small><b>Next step:</b>{" "}{presentation.nextResolution}</small>
    </section>
  );
}
