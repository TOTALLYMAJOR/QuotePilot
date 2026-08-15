import { Suspense, useEffect, useState } from "react";
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
          ? <div className="qp-route-loading" role="status">Loading {surfaceName}...</div>
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
