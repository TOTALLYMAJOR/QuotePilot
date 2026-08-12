import {
  Component,
  Fragment,
  lazy,
  useEffect,
  useId,
  useRef
} from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { recordDiagnosticEvent } from "../lib/sessionDiagnostics";

export const UNSAVED_QUOTE_RELOAD_PROMPT =
  "Reload workspace? Your unsaved quote changes will be discarded.";

export function confirmRecoveryReload({
  surfaceKind = "tool",
  hasUnsavedWorkspaceChanges = false,
  confirmDiscard
} = {}) {
  if (surfaceKind === "route" || !hasUnsavedWorkspaceChanges) return true;
  return typeof confirmDiscard === "function"
    ? confirmDiscard(UNSAVED_QUOTE_RELOAD_PROMPT)
    : false;
}

function safeSurfaceName(value) {
  const normalized = String(value || "QuotePilot")
    .replace(/[^a-zA-Z0-9 &'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 80) || "QuotePilot";
}

export function classifyRecoverableUiFailure(error) {
  const signature = `${String(error?.name || "")} ${String(error?.message || "")}`
    .toLowerCase();
  return /chunkloaderror|loading chunk|dynamically imported module|module script|importing a module/.test(signature)
    ? "chunk_load"
    : "render";
}

export function resolveRecoverableImportUrl(error, attempt = 1, baseHref = "") {
  const message = String(error?.message || "");
  const candidate = message.match(/(?:https?:\/\/|\.{0,2}\/)[^\s"'()]+/)?.[0] || "";
  const base = String(baseHref || (
    typeof window !== "undefined" ? window.location.href : ""
  ));
  if (!candidate || !base) return "";
  try {
    const baseUrl = new URL(base);
    const importUrl = new URL(candidate, baseUrl);
    if (importUrl.origin !== baseUrl.origin || !["http:", "https:"].includes(importUrl.protocol)) {
      return "";
    }
    importUrl.searchParams.set("qp-recovery-attempt", String(Math.max(1, Number(attempt) || 1)));
    return importUrl.href;
  } catch {
    return "";
  }
}

function recordUiRecoveryEvent({ level = "error", action, surfaceName, surfaceKind, failureKind }) {
  try {
    recordDiagnosticEvent({
      level,
      type: "ui.recovery",
      message: "A recoverable user interface surface required recovery.",
      context: {
        action,
        surface: safeSurfaceName(surfaceName),
        surfaceKind: surfaceKind === "route" ? "route" : "tool",
        failureKind: failureKind === "chunk_load" ? "chunk_load" : "render"
      }
    });
  } catch {
    // Recovery UI must remain available when diagnostics storage is unavailable.
  }
}

export function createRecoverableLazy(importer, displayName = "RecoverableLazy") {
  let CurrentLazyComponent = lazy(importer);
  let retryAttempt = 0;
  function RecoverableLazyComponent(props) {
    const Current = CurrentLazyComponent;
    return <Current {...props} />;
  }
  RecoverableLazyComponent.displayName = displayName;
  RecoverableLazyComponent.retry = (error) => {
    retryAttempt += 1;
    const retryUrl = resolveRecoverableImportUrl(error, retryAttempt);
    CurrentLazyComponent = lazy(
      retryUrl
        ? () => import(/* @vite-ignore */ retryUrl)
        : importer
    );
  };
  return RecoverableLazyComponent;
}

function RecoveryActions({
  surfaceKind,
  onRetry,
  onReload,
  onClose,
  retryButtonRef
}) {
  return (
    <div className="ui-recovery-actions">
      <button
        ref={retryButtonRef}
        type="button"
        className="cta"
        data-modal-initial-focus
        onClick={onRetry}
      >
        Try again
      </button>
      <button type="button" className="ghost" onClick={onReload}>
        {surfaceKind === "route" ? "Reload page" : "Reload workspace"}
      </button>
      <button type="button" className="ghost" onClick={onClose}>
        {surfaceKind === "route" ? "Back to QuotePilot" : "Close tool"}
      </button>
    </div>
  );
}

function RecoverableSurfaceFailure({
  surfaceName,
  surfaceKind,
  onRetry,
  onReload,
  onClose,
  returnFocusRef
}) {
  const headingId = useId();
  const retryButtonRef = useRef(null);
  const isTool = surfaceKind !== "route";
  const { dialogRef } = useModalDialog({
    open: isTool,
    onRequestClose: onClose,
    initialFocusRef: retryButtonRef,
    returnFocusRef
  });

  useEffect(() => {
    if (isTool) return undefined;
    const frame = window.requestAnimationFrame(() => retryButtonRef.current?.focus());
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isTool, onClose]);

  const RecoveryHeading = isTool ? "h2" : "h1";

  const copy = (
    <>
      <p className="eyebrow">Recovery available</p>
      <RecoveryHeading id={headingId}>{safeSurfaceName(surfaceName)} did not load</RecoveryHeading>
      <p role="alert">
        QuotePilot kept the rest of your work available. Try this surface again, or reload if the problem continues.
      </p>
      <p className="source-note">
        Check recent work before repeating an action. Technical details were not shown on this screen.
      </p>
      <RecoveryActions
        surfaceKind={surfaceKind}
        onRetry={onRetry}
        onReload={onReload}
        onClose={onClose}
        retryButtonRef={retryButtonRef}
      />
    </>
  );

  if (!isTool) {
    return (
      <main className="ui-recovery-route container" aria-labelledby={headingId}>
        <section className="panel ui-recovery-card">{copy}</section>
      </main>
    );
  }

  return (
    <div
      ref={dialogRef}
      className="modal-overlay ui-recovery-overlay"
      data-layout-overlap-allowed="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <section className="modal-card ui-recovery-card">{copy}</section>
    </div>
  );
}

export function LazySurfaceLoading({ surfaceName, onClose, returnFocusRef }) {
  const headingId = useId();
  const closeButtonRef = useRef(null);
  const { dialogRef } = useModalDialog({
    open: true,
    onRequestClose: onClose,
    initialFocusRef: closeButtonRef,
    returnFocusRef
  });
  return (
    <div
      ref={dialogRef}
      className="modal-overlay modal-loading-overlay"
      data-layout-overlap-allowed="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <div className="modal-card modal-loading-card">
        <strong id={headingId}>Opening {safeSurfaceName(surfaceName)}...</strong>
        <span>Loading this tool only when it is needed.</span>
        <button
          ref={closeButtonRef}
          type="button"
          className="ghost compact"
          data-modal-initial-focus
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export class RecoverableErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0, failureKind: "render" };
  }

  static getDerivedStateFromError(error) {
    return {
      error,
      failureKind: classifyRecoverableUiFailure(error)
    };
  }

  componentDidCatch(error) {
    recordUiRecoveryEvent({
      action: "failure",
      surfaceName: this.props.surfaceName,
      surfaceKind: this.props.surfaceKind,
      failureKind: classifyRecoverableUiFailure(error)
    });
  }

  handleRetry = () => {
    recordUiRecoveryEvent({
      level: "info",
      action: "retry",
      surfaceName: this.props.surfaceName,
      surfaceKind: this.props.surfaceKind,
      failureKind: this.state.failureKind
    });
    this.props.onRetry?.(this.state.error);
    this.setState((current) => ({
      error: null,
      attempt: current.attempt + 1,
      failureKind: "render"
    }));
  };

  handleReload = () => {
    const confirmDiscard = typeof window !== "undefined"
      ? window.confirm.bind(window)
      : null;
    if (!confirmRecoveryReload({
      surfaceKind: this.props.surfaceKind,
      hasUnsavedWorkspaceChanges: this.props.hasUnsavedWorkspaceChanges,
      confirmDiscard
    })) {
      recordUiRecoveryEvent({
        level: "info",
        action: "reload_cancelled",
        surfaceName: this.props.surfaceName,
        surfaceKind: this.props.surfaceKind,
        failureKind: this.state.failureKind
      });
      return;
    }
    recordUiRecoveryEvent({
      level: "info",
      action: "reload",
      surfaceName: this.props.surfaceName,
      surfaceKind: this.props.surfaceKind,
      failureKind: this.state.failureKind
    });
    if (typeof this.props.onReload === "function") {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  handleClose = () => {
    recordUiRecoveryEvent({
      level: "info",
      action: "close",
      surfaceName: this.props.surfaceName,
      surfaceKind: this.props.surfaceKind,
      failureKind: this.state.failureKind
    });
    this.props.onClose?.();
  };

  render() {
    if (this.props.active === false && this.state.error) {
      return null;
    }

    if (this.state.error) {
      return (
        <RecoverableSurfaceFailure
          surfaceName={this.props.surfaceName}
          surfaceKind={this.props.surfaceKind}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
          onClose={this.handleClose}
          returnFocusRef={this.props.returnFocusRef}
        />
      );
    }

    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
