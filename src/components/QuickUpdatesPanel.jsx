import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle,
  CurrencyDollar,
  ForkKnife,
  Info,
  Package,
  UserGear,
  WarningCircle
} from "./ProductIcons";
import {
  QUICK_UPDATES_PHASE,
  buildQuickUpdatesRequest,
  createQuickUpdatesState,
  isQuickUpdatesBusy,
  normalizeQuickUpdatesPersistedEffects,
  normalizeQuickUpdatesReviewDelta,
  quickUpdateStyleLabel,
  quickUpdatesReducer,
  shouldGuardQuickUpdatesDismissal
} from "../lib/quickUpdatesState";
import "./quickUpdatesPanel.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusableChildren(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => (
    element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0
  ));
}

function isolateBackground(portalNode) {
  if (!portalNode || typeof document === "undefined") return () => {};
  const snapshots = new Map();
  const isolate = (node) => {
    if (
      !(node instanceof HTMLElement)
      || node === portalNode
      || ["SCRIPT", "STYLE", "LINK"].includes(node.tagName)
      || snapshots.has(node)
    ) return;
    snapshots.set(node, {
      hadAriaHidden: node.hasAttribute("aria-hidden"),
      ariaHidden: node.getAttribute("aria-hidden"),
      hadInert: node.hasAttribute("inert"),
      inert: node.getAttribute("inert"),
      inertProperty: "inert" in node ? node.inert : undefined
    });
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
    if ("inert" in node) node.inert = true;
  };
  const isolateBodyChildren = () => Array.from(document.body.children).forEach(isolate);
  isolateBodyChildren();
  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(isolateBodyChildren)
    : null;
  observer?.observe(document.body, { childList: true });
  return () => {
    observer?.disconnect();
    snapshots.forEach((snapshot, node) => {
      if ("inert" in node && snapshot.inertProperty !== undefined) {
        node.inert = snapshot.inertProperty;
      }
      if (snapshot.hadInert) node.setAttribute("inert", snapshot.inert ?? "");
      else node.removeAttribute("inert");
      if (snapshot.hadAriaHidden) node.setAttribute("aria-hidden", snapshot.ariaHidden ?? "");
      else node.removeAttribute("aria-hidden");
    });
  };
}

function requestError(result, fallback) {
  return String(
    result?.userMessage
    || result?.message
    || result?.reason
    || result?.error
    || fallback
  ).trim();
}

function failureEvent(result, fallback, recoveryPhase) {
  const status = String(result?.status || "").trim().toLowerCase();
  const type = status === "conflict"
    ? "CONFLICT"
    : status === "uncertain"
      ? "UNCERTAIN"
      : "FAILURE";
  return {
    type,
    error: requestError(result, fallback),
    recoveryPhase,
    recoveryAction: String(
      result?.recoveryAction || (status === "uncertain" ? "reconcile_only" : "")
    ).trim(),
    recoveryLabel: String(result?.recoveryLabel || "").trim(),
    retryable: status === "uncertain" ? false : result?.retryable !== false
  };
}

function formatMoney(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function staffingEffectLabel(value = {}) {
  const label = (count, singular, plural) => (
    count === null || count === undefined
      ? `${plural} not recorded`
      : `${count} ${Number(count) === 1 ? singular : plural}`
  );
  return [
    label(value.servers, "server", "servers"),
    label(value.chefs, "chef", "chefs"),
    label(value.bartenders, "bartender", "bartenders")
  ].join(" · ");
}

function statusCopy(phase, previewPending) {
  if (previewPending) return "Preparing the exact change for review…";
  if (phase === QUICK_UPDATES_PHASE.DIRTY) return "1 unsaved change";
  if (phase === QUICK_UPDATES_PHASE.SAVING) return "Saving the reviewed menu change…";
  if (phase === QUICK_UPDATES_PHASE.REFRESHING) return "Refreshing the saved opportunity…";
  if (phase === QUICK_UPDATES_PHASE.SAVED) return "Saved opportunity refreshed";
  if ([QUICK_UPDATES_PHASE.FAILURE, QUICK_UPDATES_PHASE.CONFLICT, QUICK_UPDATES_PHASE.UNCERTAIN].includes(phase)) {
    return "Your unsaved menu draft is still here";
  }
  return "No unsaved changes";
}

export default function QuickUpdatesPanel({
  open,
  dialogId,
  quote,
  staffingSummary = "Staffing details are available in the opportunity.",
  pricingSummary = "Saved pricing is available in the opportunity.",
  serviceStyles = [],
  returnFocusRef = null,
  onClose,
  onPreviewQuickUpdate,
  onSaveQuickUpdate,
  onReviewStaffing,
  onReviewPricing,
  onOpenQuickUpdatesLibrary,
  onOpenAuthoritativeEditor,
  onQuickUpdatesGuardChange
}) {
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const menuTriggerId = useId();
  const menuPanelId = useId();
  const staffingTriggerId = useId();
  const staffingPanelId = useId();
  const pricingTriggerId = useId();
  const pricingPanelId = useId();
  const [state, dispatch] = useReducer(
    quickUpdatesReducer,
    { savedStyle: quote?.event?.style },
    createQuickUpdatesState
  );
  const [expandedSections, setExpandedSections] = useState({
    menu: true,
    staffing: false,
    pricing: false
  });
  const portalRootRef = useRef(null);
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const serviceStyleRef = useRef(null);
  const reviewPrimaryRef = useRef(null);
  const keepEditingRef = useRef(null);
  const previousFocusRef = useRef(null);
  const pendingContinuationRef = useRef(null);
  const restoreFocusOnExitRef = useRef(true);
  const openSessionRef = useRef({ open: false, quoteId: "" });
  const saveInFlightRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const quoteId = String(quote?.id || quote?.quoteId || "").trim();
  const eventName = String(
    quote?.event?.name || quote?.quoteNumber || "Selected opportunity"
  ).trim();
  const savedStyle = String(quote?.event?.style || "").trim();
  const busy = isQuickUpdatesBusy(state);
  const guarded = shouldGuardQuickUpdatesDismissal(state);
  const reviewDelta = state.reviewDelta?.[0] || null;
  const errorPhase = [
    QUICK_UPDATES_PHASE.FAILURE,
    QUICK_UPDATES_PHASE.CONFLICT,
    QUICK_UPDATES_PHASE.UNCERTAIN
  ].includes(state.phase);
  const reconcileOnly = state.phase === QUICK_UPDATES_PHASE.UNCERTAIN
    || state.recoveryAction === "reconcile_only";
  const editorHandoff = state.recoveryAction === "open_editor";
  const persistedEffects = state.preview?.persistedEffects || null;
  const styles = useMemo(() => Array.from(new Set([
    savedStyle,
    ...serviceStyles
  ].map((item) => String(item || "").trim()).filter(Boolean))), [savedStyle, serviceStyles]);

  useEffect(() => {
    const prior = openSessionRef.current;
    const startingSession = open && (!prior.open || prior.quoteId !== quoteId);
    openSessionRef.current = { open: Boolean(open), quoteId };
    if (startingSession) {
      restoreFocusOnExitRef.current = true;
      pendingContinuationRef.current = null;
      setExpandedSections({ menu: true, staffing: false, pricing: false });
      dispatch({ type: "OPEN", savedStyle });
    } else if (!open && prior.open) {
      dispatch({ type: "CLOSE" });
    }
  }, [open, quoteId, savedStyle]);

  const toggleSection = useCallback((section) => {
    if (isQuickUpdatesBusy(stateRef.current)) return;
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }, []);

  useEffect(() => {
    if (!open || state.phase === QUICK_UPDATES_PHASE.CLOSED) return undefined;
    return isolateBackground(portalRootRef.current);
  }, [open, state.phase === QUICK_UPDATES_PHASE.CLOSED]);

  useEffect(() => {
    if (!open || state.phase === QUICK_UPDATES_PHASE.CLOSED || typeof document === "undefined") {
      return undefined;
    }
    previousFocusRef.current = returnFocusRef?.current || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (!restoreFocusOnExitRef.current) return;
      const target = returnFocusRef?.current || previousFocusRef.current;
      window.requestAnimationFrame(() => {
        if (target?.isConnected !== false && typeof target?.focus === "function") target.focus();
      });
    };
  }, [open, returnFocusRef, state.phase === QUICK_UPDATES_PHASE.CLOSED]);

  useEffect(() => {
    if (!open || (!guarded && !busy) || typeof window === "undefined") return undefined;
    const protectUnsavedDraft = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedDraft);
    return () => window.removeEventListener("beforeunload", protectUnsavedDraft);
  }, [busy, guarded, open]);

  const finishDismissal = useCallback((reason, continuation = null) => {
    restoreFocusOnExitRef.current = typeof continuation !== "function";
    dispatch({ type: "CLOSE" });
    onClose?.({ reason });
    continuation?.();
  }, [onClose]);

  const requestDismissal = useCallback((reason = "close", continuation = null, returnFocus = null) => {
    const current = stateRef.current;
    if (isQuickUpdatesBusy(current)) return { status: "blocked", reason: "busy" };
    if (current.dismissal) return { status: "guarded", reason: "already_pending" };
    if (!shouldGuardQuickUpdatesDismissal(current)) {
      finishDismissal(reason, continuation);
      return { status: "dismissed" };
    }
    pendingContinuationRef.current = {
      reason,
      continuation,
      returnFocus: current.phase === QUICK_UPDATES_PHASE.REVIEW
        ? reviewPrimaryRef.current
        : serviceStyleRef.current || returnFocus || document.activeElement
    };
    dispatch({ type: "REQUEST_DISMISS", reason });
    return { status: "guarded" };
  }, [finishDismissal]);

  useEffect(() => {
    if (!open || state.phase === QUICK_UPDATES_PHASE.CLOSED) {
      onQuickUpdatesGuardChange?.(null);
      return;
    }
    onQuickUpdatesGuardChange?.({
      modelId: "quick-updates-navigation-guard-v1",
      open: true,
      phase: state.phase,
      dirty: guarded,
      blocked: guarded,
      busy,
      requestDismiss: requestDismissal
    });
  }, [busy, guarded, onQuickUpdatesGuardChange, open, requestDismissal, state.phase]);

  useEffect(() => () => onQuickUpdatesGuardChange?.(null), [onQuickUpdatesGuardChange]);

  const keepEditing = useCallback(() => {
    const returnTarget = pendingContinuationRef.current?.returnFocus;
    pendingContinuationRef.current = null;
    dispatch({ type: "KEEP_EDITING" });
    window.requestAnimationFrame(() => {
      if (returnTarget?.isConnected !== false && typeof returnTarget?.focus === "function") {
        returnTarget.focus();
      } else if (stateRef.current.phase === QUICK_UPDATES_PHASE.REVIEW) {
        reviewPrimaryRef.current?.focus();
      } else {
        serviceStyleRef.current?.focus();
      }
    });
  }, []);

  const discardDraft = useCallback(() => {
    const pending = pendingContinuationRef.current;
    if (!pending) return;
    pendingContinuationRef.current = null;
    restoreFocusOnExitRef.current = typeof pending.continuation !== "function";
    dispatch({ type: "DISCARD" });
    onClose?.({ reason: pending.reason, discarded: true });
    pending.continuation?.();
  }, [onClose]);

  useEffect(() => {
    if (!state.dismissal) return undefined;
    const frame = window.requestAnimationFrame(() => keepEditingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [state.dismissal]);

  useEffect(() => {
    if (!open || state.phase === QUICK_UPDATES_PHASE.CLOSED || typeof document === "undefined") {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (stateRef.current.dismissal) {
          keepEditing();
        } else {
          requestDismissal("escape", null, document.activeElement);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const scope = stateRef.current.dismissal
        ? drawerRef.current?.querySelector(".qup-dismissal-guard")
        : drawerRef.current;
      const focusable = focusableChildren(scope);
      if (!focusable.length) {
        event.preventDefault();
        scope?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [keepEditing, open, requestDismissal, state.phase]);

  const handleReview = async ({ recover = false } = {}) => {
    const current = stateRef.current;
    const request = buildQuickUpdatesRequest({
      quote,
      savedStyle: current.savedStyle,
      draftStyle: current.draftStyle
    });
    if (!request || typeof onPreviewQuickUpdate !== "function") {
      dispatch({
        type: "FAILURE",
        error: "Refresh this opportunity before reviewing the menu change.",
        recoveryPhase: QUICK_UPDATES_PHASE.DIRTY
      });
      return;
    }
    if (recover) dispatch({ type: "BACK_TO_EDIT" });
    dispatch({ type: "REVIEW_REQUEST" });
    try {
      const result = await onPreviewQuickUpdate(request);
      if (String(result?.status || "").trim().toLowerCase() !== "ready") {
        dispatch(failureEvent(
          result,
          "The menu change could not be prepared for review.",
          QUICK_UPDATES_PHASE.DIRTY
        ));
        return;
      }
      const delta = normalizeQuickUpdatesReviewDelta(
        result.delta || result.persistedDelta || result.preview?.delta,
        request.delta
      );
      if (!delta) {
        dispatch({
          type: "FAILURE",
          error: "The authoritative preview did not match this exact menu draft. Refresh and review it again.",
          recoveryPhase: QUICK_UPDATES_PHASE.DIRTY
        });
        return;
      }
      const persistedEffects = normalizeQuickUpdatesPersistedEffects(
        result.persistedEffects,
        request
      );
      if (!persistedEffects) {
        dispatch({
          type: "FAILURE",
          error: "The authoritative review did not return the exact enumerated material save effects for this menu draft.",
          recoveryPhase: QUICK_UPDATES_PHASE.DIRTY,
          recoveryAction: "open_editor",
          recoveryLabel: "Continue in quote editor",
          retryable: false
        });
        return;
      }
      dispatch({
        type: "REVIEW_READY",
        preview: { ...result, persistedEffects },
        delta
      });
    } catch (error) {
      dispatch(failureEvent(
        error,
        "The menu change could not be prepared for review.",
        QUICK_UPDATES_PHASE.DIRTY
      ));
    }
  };

  const handleSave = async () => {
    if (saveInFlightRef.current) return;
    let writeReturned = false;
    const request = buildQuickUpdatesRequest({
      quote,
      savedStyle: state.savedStyle,
      draftStyle: state.draftStyle
    });
    if (!request || !state.preview || typeof onSaveQuickUpdate !== "function") {
      dispatch({
        type: "FAILURE",
        error: "This reviewed change no longer matches the saved opportunity. Return to edit and review it again.",
        recoveryPhase: QUICK_UPDATES_PHASE.DIRTY
      });
      return;
    }
    saveInFlightRef.current = true;
    dispatch({ type: "SAVE_REQUEST" });
    try {
      const result = await onSaveQuickUpdate({
        ...request,
        preview: state.preview
      }, {
        onPersisted: (receipt) => {
          writeReturned = true;
          dispatch({ type: "PERSISTED", receipt });
        }
      });
      const status = String(result?.status || "").trim().toLowerCase();
      if (
        status !== "saved"
        || String(result?.quote?.id || result?.quote?.quoteId || "").trim() !== request.quoteId
        || String(result?.quote?.organizationId || "").trim() !== request.organizationId
        || String(result?.quote?.event?.style || "").trim() !== request.patch.event.style
      ) {
        dispatch(failureEvent(
          status === "saved"
            ? { status: "uncertain", message: "The save returned, but the refreshed opportunity did not confirm the exact menu change." }
            : result,
          "The menu change was not confirmed by the refreshed opportunity.",
          QUICK_UPDATES_PHASE.REVIEW
        ));
        return;
      }
      dispatch({ type: "SAVED", receipt: result.receipt });
    } catch (error) {
      const persistenceMayHaveCommitted = writeReturned
        || stateRef.current.phase === QUICK_UPDATES_PHASE.REFRESHING
        || Boolean(stateRef.current.receipt);
      dispatch(failureEvent(
        persistenceMayHaveCommitted
          ? {
            status: "uncertain",
            message: error?.message || "The write returned, but its authoritative readback did not complete.",
            recoveryAction: "reconcile_only",
            recoveryLabel: "Reconcile in quote editor",
            retryable: false
          }
          : error,
        "The menu change was not saved. Your draft remains available.",
        QUICK_UPDATES_PHASE.REVIEW
      ));
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const returnToRecoveryPhase = () => {
    if (state.recoveryPhase === QUICK_UPDATES_PHASE.REVIEW && state.reviewDelta) {
      dispatch({ type: "BACK_TO_EDIT" });
      window.requestAnimationFrame(() => serviceStyleRef.current?.focus());
      return;
    }
    dispatch({ type: "BACK_TO_EDIT" });
    window.requestAnimationFrame(() => serviceStyleRef.current?.focus());
  };

  if (!open || state.phase === QUICK_UPDATES_PHASE.CLOSED || typeof document === "undefined") return null;

  const phaseTitle = state.phase === QUICK_UPDATES_PHASE.REVIEW
    ? "Review menu change"
    : state.phase === QUICK_UPDATES_PHASE.SAVED
      ? "Menu change saved"
      : errorPhase
        ? "Quick Updates needs attention"
        : "Quick Updates";
  const savedDisplay = quickUpdateStyleLabel(state.savedStyle);
  const draftDisplay = quickUpdateStyleLabel(state.draftStyle);
  const controlsDisabled = busy || state.previewPending;

  return createPortal(
    <div
      ref={portalRootRef}
      className="qup-root"
      data-testid="quick-updates-panel"
      data-quick-updates-phase={state.phase}
      data-layout-overlap-allowed="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !state.dismissal) {
          requestDismissal("backdrop", null, document.activeElement);
        }
      }}
    >
      <div
        id={dialogId || undefined}
        ref={drawerRef}
        className="qup-drawer"
        role={state.dismissal ? undefined : "dialog"}
        aria-modal={state.dismissal ? undefined : "true"}
        aria-labelledby={state.dismissal ? undefined : titleId}
        aria-describedby={state.dismissal ? undefined : descriptionId}
        aria-busy={busy ? "true" : "false"}
        tabIndex={-1}
      >
        <div
          className="qup-drawer-surface"
          aria-hidden={state.dismissal ? "true" : undefined}
          inert={state.dismissal ? "" : undefined}
        >
        <div className="qup-header">
          <div>
            <p className="qup-eyebrow">{eventName}</p>
            <h2 id={titleId}>{phaseTitle}</h2>
            <p id={descriptionId}>
              Make the common menu change here. Use the focused handoffs when staffing, pricing, or the full Library needs more room.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="qup-close"
            aria-label="Close Quick Updates"
            onClick={(event) => requestDismissal("close", null, event.currentTarget)}
            disabled={busy}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="qup-body">
          {state.phase === QUICK_UPDATES_PHASE.REVIEW ? (
            <section className="qup-review" aria-labelledby="qup-review-delta-title">
              <h3 id="qup-review-delta-title">Requested change</h3>
              <dl className="qup-delta">
                <div>
                  <dt>Service style before</dt>
                  <dd>{reviewDelta?.beforeLabel || savedDisplay}</dd>
                </div>
                <div>
                  <dt>Service style after</dt>
                  <dd>{reviewDelta?.afterLabel || draftDisplay}</dd>
                </div>
              </dl>
              <h3>Enumerated material save effects</h3>
              <dl className="qup-delta">
                <div>
                  <dt>Quote total</dt>
                  <dd>
                    {formatMoney(
                      persistedEffects?.pricing?.authoritativeTotal?.before,
                      persistedEffects?.pricing?.currency
                    )}
                    {" → "}
                    {formatMoney(
                      persistedEffects?.pricing?.authoritativeTotal?.proposedAfter,
                      persistedEffects?.pricing?.currency
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Deposit requirement</dt>
                  <dd>
                    {formatMoney(
                      persistedEffects?.pricing?.depositRequirement?.before,
                      persistedEffects?.pricing?.currency
                    )}
                    {" → "}
                    {formatMoney(
                      persistedEffects?.pricing?.depositRequirement?.proposedAfter,
                      persistedEffects?.pricing?.currency
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Staffing</dt>
                  <dd>
                    {staffingEffectLabel(persistedEffects?.staffing?.before)}
                    {persistedEffects?.staffing?.changed
                      ? ` → ${staffingEffectLabel(persistedEffects?.staffing?.after)}`
                      : " — unchanged by the trusted edit plan"}
                  </dd>
                </div>
                <div>
                  <dt>Quote state</dt>
                  <dd>
                    {persistedEffects?.status?.before || "draft"}
                    {" → "}
                    {persistedEffects?.status?.after || "draft"}
                  </dd>
                </div>
                <div>
                  <dt>Saved version</dt>
                  <dd>
                    {persistedEffects?.version?.beforeVersionNumber}
                    {` (${persistedEffects?.version?.beforeRevisionId}) → `}
                    {persistedEffects?.version?.afterVersionNumber}
                    {` (${persistedEffects?.version?.afterRevisionId})`}
                  </dd>
                </div>
              </dl>
              <p className="qup-boundary">
                Proposal workflow evidence is preserved. Saving refreshes the portal projection to {persistedEffects?.portal?.activeRevisionIdAfter}, retains portal access identity, and records the edit lifecycle. It does not publish or deliver a proposal.
              </p>
              <p className="qup-boundary">
                Portal issuance, expiry, and edit timestamps are assigned at save and confirmed from the server write receipt; this review does not predict their exact values.
              </p>
              <p className="qup-boundary">
                {Number(persistedEffects?.dependencies?.impact?.counts?.total || 0)} dependent {Number(persistedEffects?.dependencies?.impact?.counts?.total || 0) === 1 ? "item" : "items"} identified by the existing Commercial Change authority. {state.preview?.authorityState === "dormant"
                  ? "Enforcement is dormant, so this dependency review is advisory."
                  : persistedEffects?.dependencies?.authorizationRequired
                    ? "Continue in the full editor for governed authorization."
                    : "No governed authorization is required for this reviewed change."}
              </p>
              <p className="qup-review-safety">
                <CheckCircle size={20} aria-hidden="true" />
                No changes have been saved.
              </p>
            </section>
          ) : state.phase === QUICK_UPDATES_PHASE.SAVED ? (
            <section className="qup-result qup-result--saved" role="status" aria-live="polite">
              <CheckCircle size={24} aria-hidden="true" />
              <div>
                <h3>{draftDisplay} is now the saved service style.</h3>
                <p>The opportunity was reread from its authoritative source before this confirmation appeared.</p>
                <dl className="qup-saved-receipt">
                  <div>
                    <dt>Saved version</dt>
                    <dd>{String(state.receipt?.activeVersionId || "Authoritative readback confirmed")}</dd>
                  </div>
                  <div>
                    <dt>Opportunity</dt>
                    <dd>{String(state.receipt?.quoteNumber || quote?.quoteNumber || eventName)}</dd>
                  </div>
                </dl>
              </div>
            </section>
          ) : errorPhase ? (
            <section className="qup-result qup-result--error" role="alert">
              <WarningCircle size={24} aria-hidden="true" />
              <div>
                <h3>{state.phase === QUICK_UPDATES_PHASE.CONFLICT
                  ? "The saved opportunity changed"
                  : state.phase === QUICK_UPDATES_PHASE.UNCERTAIN
                    ? "The saved result is not confirmed"
                    : editorHandoff
                      ? "Continue in the quote editor"
                    : "The request did not complete"}</h3>
                <p>{state.error}</p>
                {reconcileOnly ? (
                  <p>A write may have committed. Do not retry this request until the authoritative opportunity is reconciled. This draft remains only as a comparison.</p>
                ) : editorHandoff ? (
                  <p>Your panel draft still changes {savedDisplay} to {draftDisplay}. Continuing to the full editor requires explicitly discarding only this local panel draft.</p>
                ) : (
                  <p>Your draft still changes {savedDisplay} to {draftDisplay}. Nothing here claims that it was saved.</p>
                )}
              </div>
            </section>
          ) : (
            <>
              <section className="qup-accordions" aria-label="Opportunity updates">
                <section className="qup-accordion qup-accordion--menu">
                  <h3>
                    <button
                      id={menuTriggerId}
                      type="button"
                      className="qup-accordion-trigger"
                      aria-expanded={expandedSections.menu}
                      aria-controls={menuPanelId}
                      onClick={() => toggleSection("menu")}
                      disabled={controlsDisabled}
                    >
                      <span className="qup-icon" aria-hidden="true"><ForkKnife size={21} /></span>
                      <span><strong>Menu</strong><small>{savedDisplay} service</small></span>
                      <span className="qup-disclosure" aria-hidden="true">{expandedSections.menu ? "−" : "+"}</span>
                    </button>
                  </h3>
                  {expandedSections.menu && (
                    <div
                      id={menuPanelId}
                      className="qup-accordion-panel"
                      role="region"
                      aria-labelledby={menuTriggerId}
                    >
                      <label className="qup-field">
                        <span>Service style</span>
                        <select
                          ref={serviceStyleRef}
                          aria-label="Service style"
                          value={state.draftStyle}
                          onChange={(event) => dispatch({ type: "EDIT_STYLE", value: event.target.value })}
                          disabled={controlsDisabled}
                        >
                          {styles.map((style) => (
                            <option key={style} value={style}>{quickUpdateStyleLabel(style)}</option>
                          ))}
                        </select>
                      </label>
                      <p
                        id={statusId}
                        className={`qup-draft-status${state.phase === QUICK_UPDATES_PHASE.DIRTY ? " qup-draft-status--dirty" : ""}`}
                        role="status"
                        aria-live="polite"
                      >
                        {state.phase === QUICK_UPDATES_PHASE.DIRTY || state.previewPending
                          ? <WarningCircle size={18} aria-hidden="true" />
                          : <CheckCircle size={18} aria-hidden="true" />}
                        {statusCopy(state.phase, state.previewPending)}
                      </p>
                    </div>
                  )}
                </section>

                <section className="qup-accordion">
                  <h3>
                    <button
                      id={staffingTriggerId}
                      type="button"
                      className="qup-accordion-trigger"
                      aria-expanded={expandedSections.staffing}
                      aria-controls={staffingPanelId}
                      onClick={() => toggleSection("staffing")}
                      disabled={controlsDisabled}
                    >
                      <span className="qup-icon" aria-hidden="true"><UserGear size={21} /></span>
                      <span><strong>Staffing</strong><small>{staffingSummary}</small></span>
                      <span className="qup-disclosure" aria-hidden="true">{expandedSections.staffing ? "−" : "+"}</span>
                    </button>
                  </h3>
                  {expandedSections.staffing && (
                    <div
                      id={staffingPanelId}
                      className="qup-accordion-panel qup-accordion-panel--handoff"
                      role="region"
                      aria-labelledby={staffingTriggerId}
                    >
                      <p>Review the saved staffing plan in its authoritative opportunity context.</p>
                      <button
                        type="button"
                        className="qup-secondary qup-task-action"
                        onClick={(event) => requestDismissal("staffing", onReviewStaffing, event.currentTarget)}
                        disabled={controlsDisabled || typeof onReviewStaffing !== "function"}
                      >
                        Review staffing
                      </button>
                    </div>
                  )}
                </section>

                <section className="qup-accordion">
                  <h3>
                    <button
                      id={pricingTriggerId}
                      type="button"
                      className="qup-accordion-trigger"
                      aria-expanded={expandedSections.pricing}
                      aria-controls={pricingPanelId}
                      onClick={() => toggleSection("pricing")}
                      disabled={controlsDisabled}
                    >
                      <span className="qup-icon" aria-hidden="true"><CurrencyDollar size={21} /></span>
                      <span><strong>Pricing</strong><small>{pricingSummary}</small></span>
                      <span className="qup-disclosure" aria-hidden="true">{expandedSections.pricing ? "−" : "+"}</span>
                    </button>
                  </h3>
                  {expandedSections.pricing && (
                    <div
                      id={pricingPanelId}
                      className="qup-accordion-panel qup-accordion-panel--handoff"
                      role="region"
                      aria-labelledby={pricingTriggerId}
                    >
                      <p>Review authoritative totals, tax, margin, and pricing details in the existing pricing context.</p>
                      <button
                        type="button"
                        className="qup-secondary qup-task-action"
                        onClick={(event) => requestDismissal("pricing", onReviewPricing, event.currentTarget)}
                        disabled={controlsDisabled || typeof onReviewPricing !== "function"}
                      >
                        Review pricing
                      </button>
                    </div>
                  )}
                </section>

                <div className="qup-library-action">
                <button
                  type="button"
                  onClick={(event) => requestDismissal("library", () => onOpenQuickUpdatesLibrary?.({
                    modelId: "quick-updates-library-handoff-v1",
                    quoteId,
                    opportunityId: quoteId,
                    organizationId: String(quote?.organizationId || "").trim(),
                    sectionId: "overview",
                    label: eventName,
                    opportunityLabel: eventName,
                    opportunity: {
                      id: quoteId,
                      label: eventName
                    },
                    requestedSection: "overview",
                    returnLabel: `Return to ${eventName}`
                  }), event.currentTarget)}
                  disabled={controlsDisabled || typeof onOpenQuickUpdatesLibrary !== "function"}
                >
                  <span className="qup-icon" aria-hidden="true"><Package size={21} /></span>
                  <span><strong>Open full Library</strong><small>Packages, menus, services, rentals, templates, and pricing.</small></span>
                </button>
                </div>
              </section>
            </>
          )}

          {(state.phase === QUICK_UPDATES_PHASE.SAVING || state.phase === QUICK_UPDATES_PHASE.REFRESHING) && (
            <section className="qup-progress" role="status" aria-live="polite">
              <span className="qup-progress-mark" aria-hidden="true" />
              <div>
                <h3>{state.phase === QUICK_UPDATES_PHASE.SAVING ? "Saving…" : "Refreshing…"}</h3>
                <p>{state.phase === QUICK_UPDATES_PHASE.SAVING
                  ? "Close and navigation are paused while the authoritative save resolves."
                  : "The save returned. QuotePilot is rereading the exact opportunity before confirming it."}</p>
              </div>
            </section>
          )}
        </div>

        <footer className="qup-footer">
          {busy ? (
            <button type="button" className="qup-primary qup-primary--full" disabled>
              {state.phase === QUICK_UPDATES_PHASE.SAVING ? "Saving…" : "Refreshing…"}
            </button>
          ) : state.phase === QUICK_UPDATES_PHASE.REVIEW ? (
            <>
              <button
                ref={reviewPrimaryRef}
                type="button"
                className="qup-secondary"
                onClick={() => dispatch({ type: "BACK_TO_EDIT" })}
              >
                Back to edit
              </button>
              {state.preview?.saveAllowed === false ? (
                typeof onOpenAuthoritativeEditor === "function" && (
                  <button
                    type="button"
                    className="qup-primary"
                    onClick={(event) => requestDismissal(
                      "editor",
                      onOpenAuthoritativeEditor,
                      event.currentTarget
                    )}
                  >
                    Continue in quote editor
                  </button>
                )
              ) : (
                <button type="button" className="qup-primary" onClick={handleSave}>
                  Save menu change
                </button>
              )}
            </>
          ) : state.phase === QUICK_UPDATES_PHASE.SAVED ? (
            <button type="button" className="qup-primary qup-primary--full" onClick={() => requestDismissal("close")}>
              Return to opportunity
            </button>
          ) : errorPhase ? (
            <div className="qup-recovery-actions">
              {!reconcileOnly && !editorHandoff && state.retryable && (
                <button
                  type="button"
                  className="qup-secondary"
                  onClick={() => handleReview({ recover: true })}
                  disabled={state.previewPending}
                >
                  {state.previewPending ? "Checking authoritative state…" : "Retry authoritative review"}
                </button>
              )}
              {!reconcileOnly && (
                <button type="button" className="qup-secondary" onClick={returnToRecoveryPhase}>
                  Back to edit
                </button>
              )}
              {typeof onOpenAuthoritativeEditor === "function" && (
                <button
                  type="button"
                  className="qup-primary"
                  onClick={(event) => requestDismissal("editor", onOpenAuthoritativeEditor, event.currentTarget)}
                >
                  {state.recoveryLabel
                    || (reconcileOnly ? "Reconcile in quote editor" : "Continue in quote editor")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="qup-safety-copy">
                <Info size={19} aria-hidden="true" />
                <span>Draft only. Nothing changes until you save.</span>
              </div>
              <div className="qup-footer-actions">
                <button
                  type="button"
                  className="qup-secondary"
                  onClick={(event) => requestDismissal("cancel", null, event.currentTarget)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="qup-primary"
                  onClick={() => handleReview()}
                  disabled={state.phase !== QUICK_UPDATES_PHASE.DIRTY || state.previewPending || busy}
                >
                  {state.previewPending ? "Preparing review…" : "Review menu change"}
                </button>
              </div>
            </>
          )}
        </footer>
        </div>

        {state.dismissal && (
          <div className="qup-guard-layer" data-layout-overlap-allowed="true">
            <section
              className="qup-dismissal-guard"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="qup-discard-title"
              aria-describedby="qup-discard-description"
              tabIndex={-1}
            >
              <h3 id="qup-discard-title">Discard unsaved Quick Updates?</h3>
              <p id="qup-discard-description">
                Your menu draft changes {savedDisplay} to {draftDisplay}. Nothing has been saved.
              </p>
              <div className="qup-guard-actions">
                <button type="button" className="qup-danger" onClick={discardDraft}>Discard draft</button>
                <button
                  ref={keepEditingRef}
                  type="button"
                  className="qup-primary"
                  data-context-initial-focus
                  onClick={keepEditing}
                >
                  Keep editing
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
