import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAmbientAction, createAmbientActionResult } from "../lib/ambientContracts";
import {
  AMBIENT_LIBRARY_SECTION_ORDER,
  buildAmbientLibrary
} from "../lib/ambientLibrary";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { useCatalogSetupDraft } from "../hooks/useCatalogSetupDraft";
import {
  useOptionalWorkspaceNavigation,
  useWorkspaceReturnContextAdapter
} from "../context/WorkspaceNavigationContext";
import { restoreWorkspaceReturnViewport } from "../lib/workspaceReturnContext";
import { AdminCatalogView } from "./AdminCatalogModal";
import BusinessSetupCenter from "./BusinessSetupCenter";
import "./ambientLibraryRoute.css";

const TenantWorkflowConfigurationStudio = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true"
  ? lazy(() => import("./TenantWorkflowConfigurationStudio")) : null;
const CATALOG_SECTION_IDS = new Set(["starter", "workflow", ...AMBIENT_LIBRARY_SECTION_ORDER]);

function text(value) {
  return String(value ?? "").trim();
}

function scheduleFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame?.(frame);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

function formatCheckedAt(value) {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return "Check time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatReviewDate(value) {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return "Review date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(timestamp));
}

function actionResult(action, kind, overrides = {}) {
  return createAmbientActionResult({
    kind,
    actionId: action.id,
    object: action.arrivalContract.object,
    reason: overrides.reason || action.arrivalContract.reason,
    consequence: overrides.consequence || action.arrivalContract.consequence,
    nextResolutions: [{
      actionId: overrides.nextActionId || action.arrivalContract.nextResolutionIds[0],
      label: overrides.nextResolution || "Review the focused Library item and choose the next available step."
    }]
  });
}

function arrivalRecoveryResult(arrivalContext, {
  reason,
  consequence,
  nextResolution
}) {
  const requestedObject = arrivalContext?.object;
  const object = requestedObject?.id && requestedObject?.type && requestedObject?.label
    ? requestedObject
    : { id: "ambient-library", type: "organization-library", label: "Library" };
  return createAmbientActionResult({
    kind: "recovery",
    actionId: "recover-library-arrival",
    object,
    reason,
    consequence,
    nextResolutions: [{
      actionId: "review-current-library",
      label: nextResolution
    }]
  });
}

function LibraryAcknowledgement({ acknowledgement, acknowledgementRef, settledLabel = "On it" }) {
  if (!acknowledgement) return null;
  const recovery = acknowledgement.result.kind === "recovery";
  return (
    <div
      ref={acknowledgementRef}
      className="ambient-library__acknowledgement"
      data-library-acknowledgement
      data-result-kind={acknowledgement.result.kind}
      role={recovery ? "alert" : "status"}
      aria-live={recovery ? "assertive" : "polite"}
      tabIndex={-1}
    >
      <div className="ambient-library__acknowledgement-summary">
        <strong>{recovery ? "Needs attention" : settledLabel}</strong>
        <span>{acknowledgement.message}</span>
      </div>
      {recovery && (
        <dl className="ambient-library__acknowledgement-details">
          <div>
            <dt>What this means</dt>
            <dd>{acknowledgement.result.consequence}</dd>
          </div>
          <div>
            <dt>Next step</dt>
            <dd>{acknowledgement.result.nextResolutions[0]?.label}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function summaryForSection(section) {
  const summary = section.summary || {};
  if (section.id === "pricing") {
    if (summary.state === "confirmed") return summary.confirmedAt
      ? `Reviewed ${formatReviewDate(summary.confirmedAt)}`
      : "Pricing reviewed";
    if (summary.state === "local_only") return "Reviewed in this browser";
    if (summary.state === "recorded_confirmation_stale") return "Recorded review needs a current catalog check";
    return "Pricing needs review";
  }
  if (section.id === "menu" && summary.availability === "unavailable") {
    return "Review current menus";
  }
  if (section.id === "templates") {
    const count = Number(summary.totalCount || 0);
    const attention = Number(summary.attentionCount || 0);
    return `${count} ${count === 1 ? "starting point" : "starting points"}${attention ? ` · ${attention} to review` : ""}`;
  }
  const active = Number(summary.activeCount || 0);
  if (section.id === "rentals") return `${active} ${active === 1 ? "collection" : "collections"}`;
  return `${active} active`;
}

function displayLabelForSection(section) {
  if (section.id === "menu") return "Menus";
  if (section.id === "addons") return "Services";
  if (section.id === "templates") return "Event templates";
  return section.label;
}

function displayActionForSection(section) {
  if (section.id === "menu") return "Review menus";
  if (section.id === "addons") return "Review services";
  if (section.id === "templates") return "Review templates";
  if (section.id === "pricing") return "Review pricing";
  return section.primaryAction.outcomeLabel;
}

function LibrarySectionIcon({ sectionId }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.7
  };
  if (sectionId === "packages") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 9h16v11H4zM3 6h18v3H3zM12 6v14M12 6H8.5a2 2 0 1 1 2-2c0 1.2 1.5 2 1.5 2Zm0 0h3.5a2 2 0 1 0-2-2c0 1.2-1.5 2-1.5 2Z" /></svg>;
  }
  if (sectionId === "menu") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M6 3v8M3.5 3v5a2.5 2.5 0 0 0 5 0V3M6 11v10M16 3v18M16 3c3 2 3 7 0 9" /></svg>;
  }
  if (sectionId === "addons") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M3 18h18M5 16a7 7 0 0 1 14 0H5ZM12 7V4M10 4h4" /></svg>;
  }
  if (sectionId === "rentals") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M7 4h10v8H7zM6 12h12v4H6zM8 16l-1 5M16 16l1 5" /></svg>;
  }
  if (sectionId === "templates") {
    return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="12" cy="12" r="9" /><path d="M14.5 8.5c-.7-.8-1.6-1.1-2.6-1.1-1.4 0-2.5.8-2.5 2 0 3 5.2 1.6 5.2 4.8 0 1.4-1.2 2.4-2.8 2.4-1.2 0-2.3-.5-3-1.4M12 5.5v13" /></svg>;
}

function LibrarySectionRow({ section, onAction, isNext = false }) {
  return (
    <li>
      <article
        className={`ambient-library__row${isNext ? " ambient-library__next" : ""}`}
        data-library-record-kind="catalog-section"
        data-library-record-id={section.id}
        data-library-health={section.health}
      >
        <span className="ambient-library__row-icon"><LibrarySectionIcon sectionId={section.id} /></span>
        <h3>{displayLabelForSection(section)}</h3>
        <p>{summaryForSection(section)}</p>
        <button
          type="button"
          className="ambient-library__row-action"
          data-library-action-id={section.primaryAction.id}
          disabled={!section.primaryAction.enabled}
          title={section.primaryAction.disabledReason || undefined}
          onClick={(event) => onAction(section.primaryAction, event.currentTarget)}
        >
          <span className="ambient-library__row-action-label">{displayActionForSection(section)}</span>
          <span aria-hidden="true">→</span>
        </button>
      </article>
    </li>
  );
}

function dependencySummary(template) {
  if (!template.unresolvedDependencies?.length && !template.issues?.length) {
    return "Everything this template uses is available in this Library view.";
  }
  const evidenceOnly = template.unresolvedDependencies?.every(
    (dependency) => dependency.state === "evidence_unavailable"
  ) && !template.issues?.length;
  if (evidenceOnly) {
    return "Saved menu choices are kept; compare them with the current menu before saving.";
  }
  const count = (template.unresolvedDependencies?.length || 0) + (template.issues?.length || 0);
  return `${count} linked ${count === 1 ? "item needs" : "items need"} review.`;
}

function normalizeEditorTarget(action) {
  if (!action) return null;
  const template = action.executionTarget.surfaceId === "library-template";
  const requestedSection = template ? "templates" : text(action.executionTarget.targetId);
  const sectionId = requestedSection === "eventTemplates" ? "templates" : requestedSection;
  if (!CATALOG_SECTION_IDS.has(sectionId)) return null;
  return {
    requestId: `library-${action.id}-${Date.now()}`,
    sectionId,
    recordId: template ? text(action.executionTarget.targetId) : "",
    reason: action.arrivalContract.reason,
    consequence: action.arrivalContract.consequence,
    action
  };
}

function LibraryState({ model, onRefresh }) {
  const loading = model.state === "loading";
  const title = loading ? "Loading Library" : "Library is not available yet";
  const description = loading
    ? "The organization catalog is being checked."
    : model.readBoundary.notes?.[0] || model.readBoundary.sourceBoundary;
  return (
    <section className="ambient-library__state" data-library-state={model.state} aria-labelledby="ambient-library-state-title">
      <p className="ambient-library__label">Current context</p>
      <h2 id="ambient-library-state-title">{title}</h2>
      <p role={loading ? "status" : "alert"}>{description}</p>
      {model.nextAction?.enabled && (
        <button
          type="button"
          className="ambient-library__primary"
          data-library-action-id={model.nextAction.id}
          onClick={() => onRefresh(model.nextAction)}
        >
          {model.nextAction.outcomeLabel}
        </button>
      )}
    </section>
  );
}

export default function AmbientLibraryRoute({
  open,
  catalog,
  organizationId = "",
  currentUserRole = "admin",
  principalId = "",
  workflowStudioEnabled = false,
  workflowSource = "",
  onClose,
  onSave,
  onApplyStarterPack,
  onCatalogMutation,
  onReload,
  saving,
  selectedEventType = "",
  onEventTypeChange,
  onToast,
  arrivalContext = null,
  arrivalAttempted = false,
  onArrivalResolution,
  onInteractionStateChange,
  contextualOrigin = null
}) {
  const navigation = useOptionalWorkspaceNavigation();
  const headingRef = useWorkspaceRouteHeadingFocus(open);
  const acknowledgementRef = useRef(null);
  const returnFocusRef = useRef(null);
  const arrivalHandledRef = useRef(null);
  const editorOpenFrameRef = useRef(null);
  const editorOpenTimerRef = useRef(null);
  const returnRestoreCancelRef = useRef(null);
  const editorOpenedFromHistoryRef = useRef(false);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const [editorTarget, setEditorTarget] = useState(null);
  const isAdmin = text(currentUserRole).toLowerCase() === "admin";
  const setupDraft = useCatalogSetupDraft({
    enabled: open && isAdmin && Boolean(organizationId),
    organizationId,
    baseCatalogRevision: Math.max(0, Number(catalog?.settings?.catalogRevision || 0))
  });
  const [templateDisclosureOpen, setTemplateDisclosureOpen] = useState(false);
  const [boundaryOpen, setBoundaryOpen] = useState(false);
  useEffect(() => {
    if (editorTarget) return;
    onInteractionStateChange?.({ dirty: false, busy: false });
  }, [editorTarget, onInteractionStateChange]);
  const handleEditorDismissGuardChange = useCallback((guard = null) => {
    navigation?.setHistoryTraversalGuard?.(guard, "ambient-library-editor");
  }, [navigation?.setHistoryTraversalGuard]);
  useEffect(() => () => {
    navigation?.setHistoryTraversalGuard?.(null, "ambient-library-editor");
  }, [navigation?.setHistoryTraversalGuard]);
  const contextualLabel = text(contextualOrigin?.label || contextualOrigin?.eventName);
  const contextualReturn = typeof contextualOrigin?.onReturn === "function"
    ? contextualOrigin.onReturn
    : null;
  const requestedReturnLabel = text(contextualOrigin?.returnLabel);
  const contextualReturnLabel = requestedReturnLabel && requestedReturnLabel.toLowerCase() !== "return"
    ? requestedReturnLabel
    : contextualLabel
      ? `Return to ${contextualLabel}`
      : "Return to opportunity";
  const contextualBanner = contextualReturn ? (
    <aside className="ambient-library__context" aria-label="Opportunity context">
      <span className="ambient-library__context-icon" aria-hidden="true">◎</span>
      <div>
        <p className="ambient-library__label">Working with {contextualLabel || "this opportunity"}</p>
        <p className="ambient-library__context-boundary">
          <span>You opened the Library from opportunity work. Nothing changes until you choose and save.</span>
          <span>Browsing changes nothing.</span>
        </p>
      </div>
      <button
        type="button"
        className="ambient-library__return"
        data-library-return-context={contextualLabel || "opportunity"}
        onClick={() => contextualReturn(contextualOrigin)}
      >
        {contextualReturnLabel}<span aria-hidden="true">→</span>
      </button>
    </aside>
  ) : null;

  const model = useMemo(() => buildAmbientLibrary({
    state: {
      ...catalog,
      organizationId,
      menuInventoryComplete: false
    },
    currentUserRole,
    capabilities: {
      openSection: isAdmin,
      openTemplate: isAdmin,
      refresh: typeof onReload === "function"
    }
  }), [catalog, currentUserRole, isAdmin, onReload, organizationId]);

  const workflowAllowed = workflowStudioEnabled === true && currentUserRole === "admin" && workflowSource === "firebase" && Boolean(organizationId && principalId);
  const workflowAction = useMemo(() => createAmbientAction({ id: "open-workflow-studio", outcomeLabel: "Open Configuration Studio", purpose: "reveal_context", roles: ["admin"], authorityLevel: "presentation", previewPolicy: "none", executionTarget: { kind: "context", targetId: "workflow", surfaceId: "workflow-configuration-studio" }, receiptType: "none", reversibility: { kind: "none" }, arrivalContract: { object: { id: "workflow", type: "workflow-definition", label: "Workflow Configuration Studio" }, reason: "Review quote approval, final guest count, event execution, and closeout follow-up workflows.", consequence: "Draft changes take effect for new workflow instances only after explicit publication.", nextResolutionIds: ["open-workflow-studio"] }, primary: false, enabled: workflowAllowed, ...(!workflowAllowed ? { disabledReason: "An enabled connected admin workspace is required." } : {}) }), [workflowAllowed]);
  const librarySections = useMemo(() => workflowAllowed ? [...model.sections, { id: "workflow", primaryAction: workflowAction }] : model.sections, [model.sections, workflowAllowed, workflowAction]);

  const captureLibraryReturnView = useCallback((hint = {}) => {
    const root = headingRef.current?.closest(".ambient-library");
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    let focus = hint?.focus && typeof hint.focus === "object" ? hint.focus : null;
    if (!focus && activeElement && root?.contains(activeElement)) {
      const record = activeElement.closest?.("[data-library-record-id]");
      const actionId = activeElement.dataset?.libraryActionId || "";
      if (record?.dataset.libraryRecordId && actionId) {
        focus = {
          kind: "library-action",
          objectId: record.dataset.libraryRecordId,
          actionId
        };
      } else if (activeElement.closest?.(".ambient-library__template-disclosure")) {
        focus = { kind: "library-disclosure", controlId: "templates" };
      } else if (activeElement.closest?.(".ambient-library__boundary")) {
        focus = { kind: "library-disclosure", controlId: "boundary" };
      }
    }
    return {
      routeId: "catalog",
      structured: { order: "library-section" },
      disclosureIds: [
        ...(templateDisclosureOpen ? ["templates"] : []),
        ...(boundaryOpen ? ["boundary"] : [])
      ],
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      focus: focus || { kind: "route-heading" }
    };
  }, [boundaryOpen, headingRef, templateDisclosureOpen]);

  const restoreLibraryReturnView = useCallback((view) => {
    returnRestoreCancelRef.current?.();
    setTemplateDisclosureOpen(view?.disclosureIds?.includes("templates") || false);
    setBoundaryOpen(view?.disclosureIds?.includes("boundary") || false);
    return new Promise((resolve) => {
      let attempt = 0;
      let active = true;
      let settled = false;
      let frameId = null;
      let cancelViewport = null;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve({ status });
      };
      const cancel = () => {
        active = false;
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        cancelViewport?.();
        finish("cancelled");
      };
      returnRestoreCancelRef.current = cancel;
      const restoreRenderedView = () => {
        if (!active) return;
        const root = headingRef.current?.closest(".ambient-library");
        const focus = view?.focus || {};
        let target = null;
        if (focus.kind === "library-action") {
          target = Array.from(root?.querySelectorAll("[data-library-action-id]") || []).find((element) => (
            element.dataset.libraryActionId === focus.actionId
            && element.closest("[data-library-record-id]")?.dataset.libraryRecordId === focus.objectId
          ));
        } else if (focus.kind === "library-disclosure") {
          target = focus.controlId === "templates"
            ? root?.querySelector(".ambient-library__template-disclosure > summary")
            : root?.querySelector(".ambient-library__boundary > summary");
        } else {
          target = headingRef.current;
        }
        if (!target && attempt < 30) {
          attempt += 1;
          frameId = window.requestAnimationFrame(restoreRenderedView);
          return;
        }
        frameId = null;
        const exactTarget = Boolean(target);
        cancelViewport = restoreWorkspaceReturnViewport({
          focusTarget: target || headingRef.current,
          scrollY: view?.scrollY
        });
        finish(exactTarget ? "restored" : "recovery");
      };
      if (typeof window !== "undefined") {
        frameId = window.requestAnimationFrame(restoreRenderedView);
      } else {
        finish("recovery");
      }
    });
  }, [headingRef]);

  useEffect(() => {
    if (open) return undefined;
    returnRestoreCancelRef.current?.();
    returnRestoreCancelRef.current = null;
    return undefined;
  }, [open]);
  useEffect(() => () => {
    returnRestoreCancelRef.current?.();
  }, []);

  useWorkspaceReturnContextAdapter({
    routeId: "catalog",
    active: Boolean(open && !editorTarget),
    capture: captureLibraryReturnView,
    restore: restoreLibraryReturnView
  });

  const announce = (result, message) => {
    setAcknowledgement({ result, message });
    scheduleFrame(() => acknowledgementRef.current?.focus({ preventScroll: true }));
  };

  const mountEditorAfterAcknowledgement = (target) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setEditorTarget(target);
      return;
    }
    if (editorOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(editorOpenFrameRef.current);
    }
    if (editorOpenTimerRef.current !== null) {
      window.clearTimeout(editorOpenTimerRef.current);
    }
    editorOpenFrameRef.current = window.requestAnimationFrame(() => {
      editorOpenFrameRef.current = null;
      editorOpenTimerRef.current = window.setTimeout(() => {
        editorOpenTimerRef.current = null;
        setEditorTarget(target);
      }, 0);
    });
  };

  const openAction = (action, trigger = null, { historyEntry = true } = {}) => {
    if (!action?.enabled) return;
    const target = normalizeEditorTarget(action);
    if (!target) {
      announce(actionResult(action, "recovery", {
        reason: "The requested Library destination is not available in this editor.",
        consequence: "Library remains open and no catalog field changed.",
        nextResolution: "Choose an available Library section."
      }), "That Library section is not available. Nothing changed.");
      return;
    }
    returnFocusRef.current = trigger || returnFocusRef.current;
    announce(actionResult(action, "pending", {
      nextResolution: target.recordId
        ? "Review this template and save only when ready."
        : "Review this section and save only when ready."
    }), target.recordId
      ? "Opening this event template with its linked details."
      : `Opening ${action.arrivalContract.object.label}.`);
    if (historyEntry && typeof navigation?.navigate === "function") {
      editorOpenedFromHistoryRef.current = true;
      navigation.navigate(
        `${navigation.location.pathname}${navigation.location.search || ""}`,
        {
          state: navigation.location.state,
          preserveSearch: false,
          preserveHash: false,
          preserveReturnContext: true,
          returnContextSurfaceId: "library-editor",
          returnContextHint: {
            focus: {
              kind: "library-action",
              objectId: target.recordId || target.sectionId,
              actionId: action.id
            }
          },
          returnContextDestination: {
            kind: "library-editor",
            sectionId: target.sectionId,
            recordId: target.recordId,
            actionId: action.id
          }
        }
      );
    }
    mountEditorAfterAcknowledgement(target);
  };

  const refreshLibrary = (action) => {
    if (!action?.enabled || typeof onReload !== "function") return;
    announce(actionResult(action, "pending", {
      nextResolution: "Review Library when the organization catalog check finishes."
    }), "Checking the organization catalog. The last completed view stays available.");
    try {
      onReload({ background: Boolean(model.readBoundary.observedAt) });
    } catch (error) {
      announce(actionResult(action, "recovery", {
        reason: error instanceof Error ? error.message : "The catalog check could not start.",
        consequence: "The current Library view remains available and no record changed.",
        nextResolution: "Try checking Library again."
      }), "The catalog check could not start. Nothing changed.");
    }
  };

  const handleAction = (action, trigger) => {
    if (action?.id === "refresh-library") refreshLibrary(action);
    else openAction(action, trigger);
  };

  const openSetupSection = (sectionId) => {
    const normalized = sectionId === "eventTemplates" ? "templates"
      : sectionId === "costs" ? "pricing" : sectionId;
    const section = model.sections.find((item) => item.id === normalized);
    if (section?.primaryAction?.enabled) {
      openAction(section.primaryAction);
      return;
    }
    announce({ kind: "context", nextResolutions: [] },
      normalized === "users" || normalized === "connections"
        ? "Use Workspace and tools to review this separately governed setup area."
        : "Ask an organization administrator to make this change.");
  };

  const handleEditorFocusResolution = (resolution) => {
    const recovered = resolution?.status === "recovery" || resolution?.result === "recovery";
    if (recovered) {
      const action = editorTarget?.action;
      if (action) {
        announce(actionResult(action, "recovery", {
          reason: resolution.reason || "That Library item is no longer available.",
          consequence: resolution.consequence || "No catalog field changed.",
          nextResolution: resolution.nextResolutions?.[0] || "Return to Library and choose an available item."
        }), resolution.reason || "That Library item is no longer available.");
      }
      onArrivalResolution?.({
        status: "recovery",
        reason: resolution?.reason || "That Library item is no longer available.",
        consequence: resolution?.consequence || "No catalog field changed.",
        nextResolution: resolution?.nextResolutions?.[0] || "Return to Library and choose an available item."
      });
      return;
    }
    if (resolution?.status === "focused" || resolution?.result === "context") {
      onArrivalResolution?.({ status: "resolved" });
      if (editorTarget?.action) {
        announce(actionResult(editorTarget.action, "context", {
          nextResolution: resolution.nextResolutions?.[0] || "Review this Library item."
        }), editorTarget.recordId ? "The requested template is ready to review." : "The requested Library section is ready to review.");
      }
    }
  };

  const closeEditor = () => {
    if (editorOpenedFromHistoryRef.current && typeof navigation?.returnToOrigin === "function") {
      const result = navigation.returnToOrigin({
        fallback: "/app/catalog",
        skipHistoryGuard: true
      });
      if (["traversing", "guarded", "blocked"].includes(result?.status)) return;
      editorOpenedFromHistoryRef.current = false;
    }
    setEditorTarget(null);
    setAcknowledgement(null);
    scheduleFrame(() => {
      const priorTrigger = returnFocusRef.current;
      const target = priorTrigger?.isConnected ? priorTrigger : headingRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!open) return;
    const destination = navigation?.returnContextDestination;
    if (destination?.kind === "library-editor") {
      const section = librarySections.find((item) => item.id === destination.sectionId);
      const template = model.templates.find((item) => item.id === destination.recordId);
      const action = destination.recordId ? template?.primaryAction : section?.primaryAction;
      if (action?.id === destination.actionId) {
        const target = normalizeEditorTarget(action);
        if (target) {
          editorOpenedFromHistoryRef.current = true;
          setEditorTarget((current) => current?.action?.id === action.id ? current : target);
          return;
        }
      }
      editorOpenedFromHistoryRef.current = false;
      setEditorTarget(null);
      const recovery = {
        reason: "That exact Library item is no longer available.",
        consequence: "No other Library item was substituted and nothing changed.",
        nextResolution: "Review the current Library and choose an available item."
      };
      setAcknowledgement({
        result: arrivalRecoveryResult({
          object: {
            id: destination.recordId || destination.sectionId,
            type: "library-item",
            label: "Requested Library item"
          }
        }, recovery),
        message: `${recovery.reason} Nothing changed.`
      });
      scheduleFrame(() => headingRef.current?.focus({ preventScroll: true }));
      return;
    }
    if (editorOpenedFromHistoryRef.current) {
      editorOpenedFromHistoryRef.current = false;
      setEditorTarget(null);
      setAcknowledgement(null);
    }
  }, [
    headingRef,
    librarySections,
    model.templates,
    navigation?.returnContextDestination,
    open
  ]);

  useEffect(() => {
    if (!open || !arrivalAttempted || !arrivalContext) return undefined;
    if (arrivalHandledRef.current === arrivalContext) return undefined;
    arrivalHandledRef.current = arrivalContext;
    const sectionId = text(arrivalContext.focus?.sectionId);
    const recordId = text(arrivalContext.focus?.recordId);

    if (arrivalContext.intentId === "browse_library" && sectionId === "overview") {
      if (arrivalContext.object?.id !== organizationId) {
        const recovery = {
          status: "recovery",
          reason: "The requested Library belongs to another or unavailable organization context.",
          consequence: "No catalog record was shown or changed for that request.",
          nextResolution: "Return to the current workspace and open its Library."
        };
        announce(arrivalRecoveryResult(arrivalContext, recovery), recovery.reason);
        onArrivalResolution?.(recovery);
        return undefined;
      }
      const frame = window.requestAnimationFrame(() => {
        headingRef.current?.focus({ preventScroll: true });
        onArrivalResolution?.({ status: "resolved" });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const section = model.sections.find((item) => item.id === sectionId);
    const template = model.templates.find((item) => item.id === recordId);
    const action = recordId ? template?.primaryAction : section?.primaryAction;
    if (!action || (recordId && sectionId !== "templates")) {
      const recovery = {
        status: "recovery",
        reason: recordId
          ? "The requested event template is not available in the current Library."
          : "The requested Library section is not available.",
        consequence: "No different item was opened, and nothing in the catalog changed.",
        nextResolution: "Choose one of the Library items shown here."
      };
      announce(arrivalRecoveryResult(arrivalContext, recovery), recovery.reason);
      onArrivalResolution?.(recovery);
      return undefined;
    }
    openAction(action, null, { historyEntry: false });
    return undefined;
  }, [arrivalAttempted, arrivalContext, model.sections, model.templates, onArrivalResolution, open, organizationId]);

  useEffect(() => () => {
    if (typeof window === "undefined") return;
    if (editorOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(editorOpenFrameRef.current);
    }
    if (editorOpenTimerRef.current !== null) {
      window.clearTimeout(editorOpenTimerRef.current);
    }
  }, []);

  if (editorTarget) {
    return (
      <main
        className="container workspace-route-main ambient-library ambient-library--editing ambient-purpose-surface"
        data-surface-contract-id={model.surfaceContract.id}
        data-surface-purpose={model.surfaceContract.purposes.join(" ")}
        data-surface-density="editorial"
        data-ambient-library-state="editing"
        data-library-context={contextualReturn ? "opportunity" : "standalone"}
        data-library-draft-preserved={open ? undefined : "route-hidden"}
        hidden={!open}
      >
        <h1 className="sr-only">Library: {editorTarget.action.arrivalContract.object.label}</h1>
        <div className="ambient-library__orientation">
          <p className="ambient-library__breadcrumb" aria-label={`Library, reviewing ${editorTarget.action.arrivalContract.object.label}`}>
            <span>Library</span><span aria-hidden="true">/</span>
            <strong>{editorTarget.action.arrivalContract.object.label}</strong>
          </p>
          <div>
            <p className="ambient-library__label">You’re reviewing</p>
            <strong>{editorTarget.action.arrivalContract.object.label}</strong>
          </div>
        </div>
        {contextualBanner}
        <LibraryAcknowledgement
          acknowledgement={acknowledgement}
          acknowledgementRef={acknowledgementRef}
          settledLabel="Ready"
        />
        <section className="ambient-library__editor" aria-label={`${editorTarget.action.arrivalContract.object.label} editor`}>
          {editorTarget.sectionId === "workflow" && workflowAllowed && TenantWorkflowConfigurationStudio ? <Suspense fallback={<p role="status">Loading Configuration Studio...</p>}><TenantWorkflowConfigurationStudio organizationId={organizationId} principalId={principalId} role={currentUserRole} enabled={workflowStudioEnabled} source={workflowSource} open={open} onClose={closeEditor} onDismissGuardChange={handleEditorDismissGuardChange} onInteractionStateChange={onInteractionStateChange} /></Suspense> : editorTarget.sectionId === "workflow" ? <p>Workflow Configuration Studio is unavailable for this workspace.</p> : <AdminCatalogView
            open={open}
            presentation="embedded"
            catalog={catalog}
            organizationId={organizationId}
            onClose={closeEditor}
            onSave={onSave}
            onApplyStarterPack={onApplyStarterPack}
            onCatalogMutation={onCatalogMutation}
            onReload={onReload}
            saving={saving}
            surfaceTitle={editorTarget.recordId
              ? `${editorTarget.action.arrivalContract.object.label} template`
              : `${editorTarget.action.arrivalContract.object.label} settings`}
            embeddedCloseLabel="Back to Library"
            initialTab={editorTarget.sectionId}
            focusRequest={editorTarget}
            onFocusResolution={handleEditorFocusResolution}
            onInteractionStateChange={onInteractionStateChange}
            onDismissGuardChange={handleEditorDismissGuardChange}
            selectedEventType={selectedEventType}
            onEventTypeChange={onEventTypeChange}
            onToast={onToast}
            catalogSetupDraftController={setupDraft}
          />}
        </section>
      </main>
    );
  }

  if (!open) return null;

  return (
    <main
      className="container workspace-route-main ambient-library ambient-purpose-surface"
      data-ambient-library-state={model.state}
      data-library-context={contextualReturn ? "opportunity" : "standalone"}
      data-surface-contract-id={model.surfaceContract.id}
      data-surface-purpose={model.surfaceContract.purposes.join(" ")}
      data-surface-density="editorial"
      aria-labelledby="ambient-library-title"
    >
      <header className="ambient-library__masthead">
        <nav className="ambient-library__breadcrumb" aria-label="Breadcrumb">
          <span>Library</span><span aria-hidden="true">/</span><strong>Overview</strong>
        </nav>
        <p className="ambient-library__label">Organization Library</p>
        <h1 id="ambient-library-title" ref={headingRef} tabIndex={-1}>The choices behind every quote.</h1>
        <p>Packages, menus, services, rentals, templates, and pricing—kept ready for the next opportunity.</p>
      </header>

      <LibraryAcknowledgement
        acknowledgement={acknowledgement}
        acknowledgementRef={acknowledgementRef}
      />

      {contextualBanner}

      <BusinessSetupCenter
        catalog={catalog}
        draftState={setupDraft}
        currentUserRole={currentUserRole}
        providerConnected={catalog?.providerConnectionReady === true}
        onOpenSection={openSetupSection}
      />

      {workflowAllowed && <section className="ambient-library__group" data-library-section="workflow" aria-label="Workflow configuration"><div className="ambient-library__group-title"><p>Workflow configuration</p><span aria-hidden="true" /></div><ol className="ambient-library__row-list"><li><article className="ambient-library__row" data-library-record-id="workflow"><span className="ambient-library__row-icon" aria-hidden="true">◎</span><h3>Business workflows</h3><p>Set tasks, timing, and review rules for quote approval, final guest count, event execution, and closeout follow-up.</p><button type="button" className="ambient-library__row-action" data-library-action-id="open-workflow-studio" data-workflow-studio-entry="library" onClick={(event) => openAction(workflowAction, event.currentTarget)}><span className="ambient-library__row-action-label">Open Configuration Studio</span><span aria-hidden="true">→</span></button></article></li></ol></section>}
      {model.sections.length === 0 ? (
        <LibraryState model={model} onRefresh={refreshLibrary} />
      ) : (
        <>
          <section className="ambient-library__group" data-library-section="catalog" aria-labelledby="ambient-library-catalog-title">
            <div className="ambient-library__group-title">
              <p>Catalog choices</p><span aria-hidden="true" />
              <h2 id="ambient-library-catalog-title" className="sr-only">Choices for new quotes</h2>
            </div>
            <ol className="ambient-library__row-list">
              {model.sections
                .filter((section) => ["packages", "menu", "addons", "rentals"].includes(section.id))
                .map((section) => (
                  <LibrarySectionRow
                    key={section.id}
                    section={section}
                    isNext={model.nextAction?.id === section.primaryAction.id}
                    onAction={handleAction}
                  />
                ))}
            </ol>
          </section>

          <section className="ambient-library__group" data-library-section="templates" aria-labelledby="ambient-library-templates-title">
            <div className="ambient-library__group-title">
              <p>Starting points &amp; pricing</p><span aria-hidden="true" />
              <h2 id="ambient-library-templates-title" className="sr-only">Event starting points and pricing</h2>
            </div>
            <ol className="ambient-library__row-list">
              {["templates", "pricing"].map((sectionId) => model.sections.find((section) => section.id === sectionId))
                .filter(Boolean)
                .map((section) => (
                  <LibrarySectionRow
                    key={section.id}
                    section={section}
                    isNext={model.nextAction?.id === section.primaryAction.id}
                    onAction={handleAction}
                  />
                ))}
            </ol>

            {model.templates.length > 0 && (
              <details
                className="ambient-library__template-disclosure"
                open={templateDisclosureOpen}
                onToggle={(event) => setTemplateDisclosureOpen(event.currentTarget.open)}
              >
                <summary>
                  Browse saved templates
                  <span>{model.templates.length}</span>
                </summary>
                <ol className="ambient-library__template-list" aria-label="Saved event templates">
                  {model.templates.map((template, index) => (
                    <li key={template.id}>
                      <article
                        className="ambient-library__template"
                        data-library-record-kind="event-template"
                        data-library-record-id={template.id}
                        data-library-health={template.dependencyState === "resolved" ? "healthy" : "attention"}
                      >
                        <div className="ambient-library__template-identity">
                          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <h3>{template.name}</h3>
                            <p>{[template.style, `${template.resolvedReferenceCount} of ${template.referenceCount} linked details available`].filter(Boolean).join(" · ")}</p>
                          </div>
                        </div>
                        <p className="ambient-library__template-dependencies">{dependencySummary(template)}</p>
                        <button
                          type="button"
                          data-library-action-id={template.primaryAction.id}
                          disabled={!template.primaryAction.enabled}
                          title={template.primaryAction.disabledReason || undefined}
                          onClick={(event) => handleAction(template.primaryAction, event.currentTarget)}
                        >
                          Review<span className="visually-hidden"> {template.name}</span><span aria-hidden="true">→</span>
                        </button>
                      </article>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>

          <aside className="ambient-library__usage">
            <span aria-hidden="true">ⓘ</span>
            <div>
              <strong>{contextualReturn ? "Used contextually" : "Available from opportunities"}</strong>
              <p>Quick Updates handles the common change. Open the full Library when comparison, structure, or broader catalog work needs more room.</p>
            </div>
          </aside>
        </>
      )}

      <details
        className="ambient-library__boundary"
        aria-labelledby="ambient-library-boundary-title"
        open={boundaryOpen}
        onToggle={(event) => setBoundaryOpen(event.currentTarget.open)}
      >
        <summary>About this view</summary>
        <div>
          <h2 id="ambient-library-boundary-title">{model.readBoundary.label}</h2>
          <p>Checked {formatCheckedAt(model.readBoundary.observedAt)}</p>
          <p>{model.readBoundary.sourceBoundary}</p>
          {model.omittedEvidence.length > 0 && (
            <details>
              <summary>{model.omittedEvidence.length} record details need review</summary>
              <ul>{model.omittedEvidence.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
            </details>
          )}
          <button
            type="button"
            className="ambient-library__refresh"
            data-library-action-id="refresh-library"
            disabled={!model.actions["refresh-library"]?.enabled || model.readBoundary.loading}
            onClick={() => refreshLibrary(model.actions["refresh-library"])}
          >
            {model.readBoundary.loading ? "Checking…" : "Check again"}
          </button>
        </div>
      </details>
    </main>
  );
}
