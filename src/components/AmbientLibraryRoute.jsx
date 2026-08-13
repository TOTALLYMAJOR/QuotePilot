import { useEffect, useMemo, useRef, useState } from "react";
import { createAmbientActionResult } from "../lib/ambientContracts";
import {
  AMBIENT_LIBRARY_SECTION_ORDER,
  buildAmbientLibrary
} from "../lib/ambientLibrary";
import { AdminCatalogView } from "./AdminCatalogModal";
import "./ambientLibraryRoute.css";

const CATALOG_SECTION_IDS = new Set(["starter", ...AMBIENT_LIBRARY_SECTION_ORDER]);

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
    if (summary.state === "confirmed") return "Reviewed for the current catalog version";
    if (summary.state === "local_only") return "Reviewed in this browser only";
    if (summary.state === "recorded_confirmation_stale") return "Recorded review needs a current catalog check";
    return "Pricing needs review";
  }
  if (section.id === "menu" && summary.availability === "unavailable") {
    return "Open Menu to review its event-specific records";
  }
  if (section.id === "templates") {
    const count = Number(summary.totalCount || 0);
    const attention = Number(summary.attentionCount || 0);
    return `${count} ${count === 1 ? "starting point" : "starting points"}${attention ? ` · ${attention} to review` : ""}`;
  }
  const total = Number(summary.totalCount || 0);
  const active = Number(summary.activeCount || 0);
  return `${active} active · ${total} recorded`;
}

function sectionExplanation(section) {
  if (section.id === "packages") return "Starting packages and the items they include.";
  if (section.id === "menu") return "Event-specific menu choices stay in their existing managed records.";
  if (section.id === "addons") return "Optional services that can be added to a quote.";
  if (section.id === "rentals") return "Rental choices and their quantity rules.";
  if (section.id === "pricing") return "Fees, tax, deposit, travel, staffing, and pricing review.";
  return "Reusable event details that give new quotes a considered starting point.";
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

function LibraryLedger({ model }) {
  const templateCount = model.sections.find((section) => section.id === "templates")?.summary?.totalCount ?? 0;
  const pricingLabel = model.pricing.state === "confirmed"
    ? "Pricing reviewed"
    : model.pricing.state === "local_only"
      ? "Browser-only review"
      : "Pricing needs review";
  return (
    <dl className="ambient-library__ledger" aria-label="Current Library context">
      <div data-library-source={model.readBoundary.kind}>
        <dt>Source</dt>
        <dd>{model.readBoundary.label}</dd>
      </div>
      <div>
        <dt>Catalog version</dt>
        <dd>{model.revision.catalogRevision ?? "Unavailable"}</dd>
      </div>
      <div data-library-pricing-state={model.pricing.state}>
        <dt>Pricing</dt>
        <dd>{pricingLabel}</dd>
      </div>
      <div>
        <dt>Templates</dt>
        <dd>{templateCount}</dd>
      </div>
    </dl>
  );
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
  onInteractionStateChange
}) {
  const headingRef = useRef(null);
  const acknowledgementRef = useRef(null);
  const returnFocusRef = useRef(null);
  const arrivalHandledRef = useRef(null);
  const editorOpenFrameRef = useRef(null);
  const editorOpenTimerRef = useRef(null);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const [editorTarget, setEditorTarget] = useState(null);

  const model = useMemo(() => buildAmbientLibrary({
    state: {
      ...catalog,
      organizationId,
      menuInventoryComplete: false
    },
    currentUserRole,
    capabilities: {
      openSection: true,
      openTemplate: true,
      refresh: typeof onReload === "function"
    }
  }), [catalog, currentUserRole, onReload, organizationId]);

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

  const openAction = (action, trigger = null) => {
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
    setEditorTarget(null);
    setAcknowledgement(null);
    scheduleFrame(() => {
      const priorTrigger = returnFocusRef.current;
      const target = priorTrigger?.isConnected ? priorTrigger : headingRef.current;
      target?.focus({ preventScroll: true });
    });
  };

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
    openAction(action);
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
        <LibraryAcknowledgement
          acknowledgement={acknowledgement}
          acknowledgementRef={acknowledgementRef}
          settledLabel="Ready"
        />
        <section className="ambient-library__editor" aria-label={`${editorTarget.action.arrivalContract.object.label} editor`}>
          <AdminCatalogView
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
            selectedEventType={selectedEventType}
            onEventTypeChange={onEventTypeChange}
            onToast={onToast}
          />
        </section>
      </main>
    );
  }

  if (!open) return null;

  return (
    <main
      className="container workspace-route-main ambient-library ambient-purpose-surface"
      data-ambient-library-state={model.state}
      data-surface-contract-id={model.surfaceContract.id}
      data-surface-purpose={model.surfaceContract.purposes.join(" ")}
      data-surface-density="editorial"
      aria-labelledby="ambient-library-title"
    >
      <header className="ambient-library__masthead">
        <div>
          <p className="ambient-library__label">For this organization</p>
          <h1 id="ambient-library-title" ref={headingRef} tabIndex={-1}>Library</h1>
          <p>The catalog and event starting points used in new quotes.</p>
        </div>
        {model.nextAction && model.state !== "loading" && (
          <aside className="ambient-library__next" data-library-next-state={model.caughtUp.eligible ? "caught-up" : "attention"}>
            <p className="ambient-library__label">{model.caughtUp.eligible ? "Current view" : "Next useful step"}</p>
            <h2>{model.caughtUp.eligible ? "Nothing in this view needs review" : model.nextAction.outcomeLabel}</h2>
            <p>{model.caughtUp.eligible ? model.caughtUp.reason : model.nextActionReason}</p>
            <button
              type="button"
              className="ambient-library__primary"
              data-library-action-id={model.nextAction.id}
              disabled={!model.nextAction.enabled}
              title={model.nextAction.disabledReason || undefined}
              onClick={(event) => handleAction(model.nextAction, event.currentTarget)}
            >
              {model.nextAction.outcomeLabel}<span aria-hidden="true">→</span>
            </button>
          </aside>
        )}
      </header>

      <LibraryAcknowledgement
        acknowledgement={acknowledgement}
        acknowledgementRef={acknowledgementRef}
      />

      {model.sections.length === 0 ? (
        <LibraryState model={model} onRefresh={refreshLibrary} />
      ) : (
        <>
          <LibraryLedger model={model} />
          <div className="ambient-library__content">
            <section className="ambient-library__section" data-library-section="catalog" aria-labelledby="ambient-library-catalog-title">
              <div className="ambient-library__section-head">
                <div>
                  <p className="ambient-library__label">Catalog</p>
                  <h2 id="ambient-library-catalog-title">Choices for new quotes</h2>
                </div>
                <p>Review saved choices and the pricing rules connected to them.</p>
              </div>
              <ol className="ambient-library__records">
                {model.sections.filter((section) => section.id !== "templates").map((section) => (
                  <li key={section.id}>
                    <article
                      className="ambient-library__record"
                      data-library-record-kind="catalog-section"
                      data-library-record-id={section.id}
                      data-library-health={section.health}
                    >
                      <div>
                        <p className="ambient-library__record-index" aria-hidden="true">
                          {String(AMBIENT_LIBRARY_SECTION_ORDER.indexOf(section.id) + 1).padStart(2, "0")}
                        </p>
                        <div>
                          <h3>{section.label}</h3>
                          <p>{sectionExplanation(section)}</p>
                        </div>
                      </div>
                      <p className="ambient-library__record-state">{summaryForSection(section)}</p>
                      <button
                        type="button"
                        data-library-action-id={section.primaryAction.id}
                        disabled={!section.primaryAction.enabled}
                        title={section.primaryAction.disabledReason || undefined}
                        onClick={(event) => handleAction(section.primaryAction, event.currentTarget)}
                      >
                        {section.primaryAction.outcomeLabel}<span aria-hidden="true">→</span>
                      </button>
                    </article>
                  </li>
                ))}
              </ol>
            </section>

            <section className="ambient-library__section ambient-library__templates" data-library-section="templates" aria-labelledby="ambient-library-templates-title">
              <div className="ambient-library__section-head">
                <div>
                  <p className="ambient-library__label">Templates</p>
                  <h2 id="ambient-library-templates-title">Event starting points</h2>
                </div>
                <button
                  type="button"
                  className="ambient-library__quiet-action"
                  data-library-action-id={model.actions["review-library-templates"]?.id}
                  disabled={!model.actions["review-library-templates"]?.enabled}
                  onClick={(event) => handleAction(model.actions["review-library-templates"], event.currentTarget)}
                >
                  {model.templates.length ? "Review all" : "Add a template"}
                </button>
              </div>
              {model.templates.length === 0 ? (
                <div className="ambient-library__template-empty">
                  <h3>No event templates yet</h3>
                  <p>Add one to give new quotes an adjustable starting point.</p>
                </div>
              ) : (
                <ol className="ambient-library__template-list">
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
              )}
            </section>
          </div>
        </>
      )}

      <aside className="ambient-library__boundary" aria-labelledby="ambient-library-boundary-title">
        <div>
          <p className="ambient-library__label">Where this came from</p>
          <h2 id="ambient-library-boundary-title">{model.readBoundary.label}</h2>
          <p>Checked {formatCheckedAt(model.readBoundary.observedAt)}</p>
        </div>
        <div>
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
      </aside>
    </main>
  );
}
