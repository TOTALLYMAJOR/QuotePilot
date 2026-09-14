import { useEffect, useMemo, useRef, useState } from "react";
import useCommercialScenarioWorkbench from "../hooks/useCommercialScenarioWorkbench";
import { commercialScenarioProjectionMatches } from "../lib/commercialScenarioWorkbench";
import FulfillmentIntelligence from "./FulfillmentIntelligence";
import "./commercialScenarioWorkbench.css";

const UNUSABLE_PROJECTION_STATES = new Set(["awaiting_preview", "loading", "stale"]);
const HEALTHY_EVIDENCE_STATES = new Set(["available", "current", "not_applicable"]);
export const COMMERCIAL_SCENARIO_WORKBENCH_CAPABILITY_ID = "commercial-scenario-workbench";

function text(value) {
  return String(value ?? "").trim();
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validGuestCount(value) {
  const count = safeCount(value);
  return count !== null && count >= 1 && count <= 400 ? count : null;
}

function guestLabel(value) {
  const count = safeCount(value);
  return count === null ? "Not available" : `${count} guest${count === 1 ? "" : "s"}`;
}

function signedCount(value) {
  if (!Number.isFinite(value) || value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} guests`;
}

function formatMoney(value, currency = "USD", { minor = false } = {}) {
  if (!Number.isFinite(value)) return "—";
  const resolvedCurrency = /^[A-Z]{3}$/u.test(text(currency).toUpperCase())
    ? text(currency).toUpperCase()
    : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: resolvedCurrency,
      maximumFractionDigits: 2
    }).format(minor ? value / 100 : value);
  } catch {
    return "—";
  }
}

function signedMoney(value, currency = "USD", { minor = false } = {}) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value), currency, { minor })}`;
}

function formatCreatedAt(value) {
  if (!value) return "Current quote";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "New option";
  return `Created ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date)}`;
}

function evidenceLabel(state) {
  return ({
    missing: "Details unavailable",
    not_yet_available: "Still checking",
    blocked_by_integration: "Connection needs attention",
    contradictory: "Details conflict",
    schema_drift: "Update needed",
    stale: "Refresh needed",
    partial: "Some details unavailable",
    failed: "Could not update",
    error: "Could not update",
    unavailable: "Not available",
    unknown: "Needs review"
  })[text(state).toLowerCase()] || "Needs review";
}

function EvidenceException({ state }) {
  const normalized = text(state).toLowerCase();
  if (!normalized || HEALTHY_EVIDENCE_STATES.has(normalized)) return null;
  return <span className="csw-exception">{evidenceLabel(normalized)}</span>;
}

export function workbenchProjectionMatchesScenario(projection, scenario) {
  if (!projection || !scenario) return false;
  if (safeCount(projection?.scenario?.proposedGuestCount) !== scenario.guestCount) return false;
  if (scenario.kind === "current") {
    const projectionRevision = text(projection?.fulfillment?.identity?.quoteRevisionId);
    if (projectionRevision !== scenario.baseQuoteRevisionId) return false;
    const request = projection?.scenario?.workbenchRequest;
    if (projection?.scenario?.proposalChanged === true) {
      return commercialScenarioProjectionMatches(scenario, request);
    }
    return !request || commercialScenarioProjectionMatches(scenario, request);
  }
  const request = projection?.scenario?.workbenchRequest;
  return Boolean(request)
    && request.scenarioId === scenario.scenarioId
    && request.generation === scenario.generation
    && request.inputDigest === scenario.inputDigest
    && request.baseQuoteRevisionId === scenario.baseQuoteRevisionId
    && safeCount(request.guestCount) === scenario.guestCount;
}

function projectionIsUsable(projection, scenario) {
  if (!workbenchProjectionMatchesScenario(projection, scenario)) return false;
  if (UNUSABLE_PROJECTION_STATES.has(projection.state)) return false;
  if (scenario.kind === "current") return true;
  return projection?.consequences?.commercial?.evidenceState === "available"
    || (projection.state === "unchanged"
      && projection?.consequences?.commercial?.evidenceState === "not_applicable");
}

function scenarioEvidenceLabel(state) {
  return ({
    saved: "Current",
    exact: "Ready",
    retained: "Previous result",
    updating: "Checking",
    unavailable: "Not checked"
  })[state] || "Not checked";
}

function workingScenarioProjection({
  scenario,
  activeScenario,
  visibleProjection,
  exactProjectionUsable,
  showingRetainedProjection,
  workbenchUpdating
}) {
  if (scenario.kind === "current") {
    return {
      state: "saved",
      projection: scenario.scenarioId === activeScenario.scenarioId && exactProjectionUsable
        ? visibleProjection
        : null
    };
  }
  if (scenario.scenarioId === activeScenario.scenarioId) {
    if (exactProjectionUsable) return { state: "exact", projection: visibleProjection };
    if (showingRetainedProjection) return { state: "retained", projection: visibleProjection };
    return { state: workbenchUpdating ? "updating" : "unavailable", projection: null };
  }
  const envelope = scenario.cachedProjection;
  if (
    commercialScenarioProjectionMatches(scenario, envelope)
    && projectionIsUsable(envelope?.projection, scenario)
  ) {
    return { state: "exact", projection: envelope.projection };
  }
  return { state: "unavailable", projection: null };
}

function comparisonMetricRows(columns, currentGuestCount) {
  const referenceProjection = columns.find((column) => column.projection)?.projection || null;
  const metric = (column, path, { minor = false } = {}) => {
    const source = column.scenario.kind === "current" ? referenceProjection : column.projection;
    const commercial = source?.consequences?.commercial || {};
    const inventory = source?.consequences?.inventory || {};
    const currency = commercial.currency || inventory.cost?.currency || "USD";
    if (path === "total") {
      return formatMoney(column.scenario.kind === "current"
        ? commercial.total?.before
        : commercial.total?.proposedAfter, currency);
    }
    if (path === "deposit") {
      return formatMoney(column.scenario.kind === "current"
        ? commercial.depositRequirement?.before
        : commercial.depositRequirement?.proposedAfter, currency);
    }
    return formatMoney(column.scenario.kind === "current"
      ? inventory.cost?.beforeMinor
      : inventory.cost?.proposedAfterMinor, inventory.cost?.currency, { minor });
  };
  const difference = (column, path, { minor = false } = {}) => {
    if (column.scenario.kind === "current") return "No change";
    if (!column.projection) return column.state === "updating" ? "Checking" : "Not checked";
    const commercial = column.projection?.consequences?.commercial || {};
    const inventory = column.projection?.consequences?.inventory || {};
    const currency = commercial.currency || inventory.cost?.currency || "USD";
    if (path === "total") return signedMoney(commercial.total?.delta, currency);
    if (path === "deposit") return signedMoney(commercial.depositRequirement?.delta, currency);
    return signedMoney(inventory.cost?.deltaMinor, inventory.cost?.currency, { minor });
  };
  return [
    {
      id: "guests",
      label: "Guests",
      value: (column) => guestLabel(column.scenario.guestCount),
      difference: (column) => signedCount(column.scenario.guestCount - currentGuestCount)
    },
    { id: "quote-total", label: "Quote total", value: (column) => metric(column, "total"), difference: (column) => difference(column, "total") },
    { id: "deposit", label: "Deposit", value: (column) => metric(column, "deposit"), difference: (column) => difference(column, "deposit") },
    { id: "ingredient-cost", label: "Ingredient cost", value: (column) => metric(column, "ingredient", { minor: true }), difference: (column) => difference(column, "ingredient", { minor: true }) }
  ];
}

function ScenarioComparison({
  scenarios,
  activeScenario,
  visibleProjection,
  exactProjectionUsable,
  showingRetainedProjection,
  workbenchUpdating,
  currentGuestCount
}) {
  const availableColumns = scenarios.map((scenario) => ({
    scenario,
    selected: scenario.scenarioId === activeScenario.scenarioId,
    ...workingScenarioProjection({
      scenario,
      activeScenario,
      visibleProjection,
      exactProjectionUsable,
      showingRetainedProjection,
      workbenchUpdating
    })
  }));
  const currentColumn = availableColumns[0];
  const selectedColumn = availableColumns.find((column) => column.selected) || currentColumn;
  const columns = selectedColumn.scenario.scenarioId === currentColumn.scenario.scenarioId
    ? [currentColumn]
    : [currentColumn, selectedColumn];
  const rows = comparisonMetricRows(columns, currentGuestCount);
  return (
    <div className="csw-comparison-shell">
      <table className="csw-comparison csw-comparison--wide" data-scenario-comparison="all">
        <caption className="visually-hidden">Current quote compared with each option</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {columns.map((column) => (
              <th
                key={column.scenario.scenarioId}
                scope="col"
                data-scenario-column={column.scenario.scenarioId}
                data-selected={column.selected || undefined}
                data-evidence-state={column.state}
              >
                <strong>{column.scenario.name}</strong>
                <span>{scenarioEvidenceLabel(column.state)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {columns.map((column) => (
                <td
                  key={column.scenario.scenarioId}
                  data-scenario-column={column.scenario.scenarioId}
                  data-selected={column.selected || undefined}
                  data-evidence-state={column.state}
                >
                  <strong>{row.value(column)}</strong>
                  {column.scenario.kind === "working" ? <small>{row.difference(column)}</small> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="csw-comparison-mobile" data-scenario-comparison="selected" aria-label={`Current compared with ${selectedColumn.scenario.name}`}>
        <header>
          <strong>Current → {selectedColumn.scenario.name}</strong>
          <span data-evidence-state={selectedColumn.state}>{scenarioEvidenceLabel(selectedColumn.state)}</span>
        </header>
        {rows.map((row) => (
          <dl key={row.id}>
            <div><dt>{row.label} · Current</dt><dd>{row.value(currentColumn)}</dd></div>
            <div><dt>{row.label} · {selectedColumn.scenario.name}</dt><dd>{row.value(selectedColumn)}</dd></div>
            <div><dt>Difference</dt><dd>{row.difference(selectedColumn)}</dd></div>
          </dl>
        ))}
      </div>
    </div>
  );
}

function focusGovernedReview() {
  if (typeof document === "undefined") return;
  const target = document.getElementById("commercial-change-impact-title")
    || document.querySelector('[data-capability-id="cwf-15b-commercial-change-impact-preview"]');
  if (!target) return;
  if (!target.matches("button, a, input, select, textarea, [tabindex]")) {
    target.setAttribute("tabindex", "-1");
  }
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  target.focus?.({ preventScroll: true });
}

function CommercialScenarioWorkbenchReady({
  projection,
  resolvedScopeKey,
  resolvedBaseRevisionId,
  resolvedCurrentGuestCount,
  resolvedProposedGuestCount,
  eventName = "",
  onGuestCountChange,
  onRequestConsequences,
  onPreview,
  onRetryConsequences,
  onReviewForCommitment,
  onOpenStaffing,
  onOpenInventory,
  inventoryEvidenceAvailable = false,
  onRefreshStaffing,
  previewDebounceMs = 420,
  clock,
  idFactory
}) {
  const workbench = useCommercialScenarioWorkbench({
    scopeKey: resolvedScopeKey,
    baseQuoteRevisionId: resolvedBaseRevisionId,
    currentGuestCount: resolvedCurrentGuestCount,
    proposedGuestCount: resolvedProposedGuestCount,
    onGuestCountChange,
    clock,
    idFactory
  });
  const {
    snapshot,
    activeScenario,
    cachedProjection,
    cachedProjectionEnvelope,
    activeProjectionRequest,
    recomputing,
    validation,
    canDuplicate,
    isCurrent,
    actions
  } = workbench;
  const [guestDraft, setGuestDraft] = useState(String(activeScenario.guestCount));
  const [constraintOpen, setConstraintOpen] = useState(false);
  const tabRefs = useRef([]);
  const lastRequestedRef = useRef("");
  const lastCachedRef = useRef({ key: "", projection: null });

  useEffect(() => {
    setGuestDraft(String(activeScenario.guestCount));
    setConstraintOpen(false);
  }, [activeScenario.generation, activeScenario.guestCount, activeScenario.scenarioId]);

  const projectionTargetsActiveScenario = workbenchProjectionMatchesScenario(
    projection,
    activeScenario
  );
  const retryAvailable = Boolean(
    projectionTargetsActiveScenario
    && projection?.nextAction?.kind === "retry_preview"
  );
  const liveProjectionUsable = projectionIsUsable(projection, activeScenario);
  const cachedProjectionUsable = Boolean(
    activeScenario.kind === "working"
    && commercialScenarioProjectionMatches(activeScenario, cachedProjectionEnvelope)
    && projectionIsUsable(cachedProjection, activeScenario)
  );
  const exactProjectionUsable = liveProjectionUsable || cachedProjectionUsable;
  const showingRetainedProjection = Boolean(
    !exactProjectionUsable
    && cachedProjection
    && cachedProjectionEnvelope?.scenarioId === activeScenario.scenarioId
    && cachedProjectionEnvelope?.baseQuoteRevisionId === activeScenario.baseQuoteRevisionId
  );
  const visibleProjection = liveProjectionUsable
    ? projection
    : cachedProjectionUsable
      ? cachedProjection
    : showingRetainedProjection
      ? cachedProjection
      : projectionTargetsActiveScenario ? projection : null;
  const visibleProjectionGuestCount = safeCount(visibleProjection?.scenario?.proposedGuestCount);

  useEffect(() => {
    if (isCurrent) return;
    if (!projectionIsUsable(projection, activeScenario)) return;
    const key = [
      activeProjectionRequest.scenarioId,
      activeProjectionRequest.generation,
      activeProjectionRequest.inputDigest,
      activeProjectionRequest.baseQuoteRevisionId,
      activeProjectionRequest.guestCount
    ].join("|");
    if (lastCachedRef.current.key === key && lastCachedRef.current.projection === projection) return;
    lastCachedRef.current = { key, projection };
    actions.cacheProjection({ ...activeProjectionRequest, projection });
  }, [actions, activeProjectionRequest, activeScenario, isCurrent, projection]);

  const requestKey = useMemo(() => [
    activeProjectionRequest.scenarioId,
    activeProjectionRequest.generation,
    activeProjectionRequest.inputDigest,
    activeProjectionRequest.baseQuoteRevisionId,
    activeProjectionRequest.guestCount
  ].join("|"), [activeProjectionRequest]);

  useEffect(() => {
    if (isCurrent) {
      lastRequestedRef.current = "";
      return undefined;
    }
    if (retryAvailable || exactProjectionUsable || typeof onRequestConsequences !== "function") {
      return undefined;
    }
    if (lastRequestedRef.current === requestKey) return undefined;
    const timer = window.setTimeout(() => {
      lastRequestedRef.current = requestKey;
      onRequestConsequences(activeProjectionRequest);
    }, Math.max(0, Number(previewDebounceMs) || 0));
    return () => window.clearTimeout(timer);
  }, [
    activeProjectionRequest,
    isCurrent,
    exactProjectionUsable,
    onRequestConsequences,
    previewDebounceMs,
    requestKey,
    retryAvailable
  ]);

  const handleGuestDraft = (value) => {
    setGuestDraft(value);
    actions.setGuestCount(value);
  };

  const requestNow = ({ recovery = false } = {}) => {
    if (recovery && typeof onRetryConsequences === "function") {
      lastRequestedRef.current = requestKey;
      onRetryConsequences(activeProjectionRequest);
      return;
    }
    if (typeof onRequestConsequences !== "function") return;
    lastRequestedRef.current = requestKey;
    onRequestConsequences(activeProjectionRequest);
  };

  const handleReview = () => {
    if (retryAvailable) {
      requestNow({ recovery: true });
      return;
    }
    if (isCurrent && projection?.scenario?.proposalChanged && !exactProjectionUsable) {
      onPreview?.(activeProjectionRequest);
      return;
    }
    if (!exactProjectionUsable) {
      requestNow();
      return;
    }
    (onReviewForCommitment || focusGovernedReview)({
      ...activeProjectionRequest,
      projection: visibleProjection
    });
  };

  const handleTabKeyDown = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = snapshot.scenarios.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowLeft"
          ? (index - 1 + snapshot.scenarios.length) % snapshot.scenarios.length
          : (index + 1) % snapshot.scenarios.length;
    const target = snapshot.scenarios[nextIndex];
    actions.selectScenario(target.scenarioId);
    tabRefs.current[nextIndex]?.focus();
  };

  const commercial = visibleProjection?.consequences?.commercial || {};
  const menuNames = Array.isArray(visibleProjection?.scenario?.selectedMenuItemNames)
    ? visibleProjection.scenario.selectedMenuItemNames
    : [];
  const guestDelta = activeScenario.guestCount - snapshot.currentScenario.guestCount;
  const currentEventName = text(eventName) || "Current event";
  const currentDraftChanged = isCurrent && projection?.scenario?.proposalChanged === true;
  const activeProposalChanged = activeScenario.guestCount !== snapshot.currentScenario.guestCount
    || (exactProjectionUsable && visibleProjection?.scenario?.proposalChanged === true);
  const currentPreviewLoading = currentDraftChanged && projection?.state === "loading";
  const workbenchUpdating = !isCurrent
    && !retryAvailable
    && (recomputing || !exactProjectionUsable);
  const reviewReady = (currentDraftChanged || (!isCurrent && activeProposalChanged))
    && exactProjectionUsable
    && !workbenchUpdating;
  const capabilityState = retryAvailable
    ? "recovery"
    : showingRetainedProjection
      ? "stale"
      : workbenchUpdating || currentPreviewLoading
        ? "loading"
        : exactProjectionUsable
          ? "success"
          : "partial";
  const retryHandlerAvailable = typeof onRetryConsequences === "function"
    || typeof onRequestConsequences === "function";
  const previewHandlerAvailable = typeof onPreview === "function";
  const primaryDisabled = isCurrent
    ? !currentDraftChanged
      || currentPreviewLoading
      || (retryAvailable
        ? !retryHandlerAvailable
        : exactProjectionUsable ? false : !previewHandlerAvailable)
    : retryAvailable
      ? !retryHandlerAvailable
      : !activeProposalChanged || workbenchUpdating;
  const primaryLabel = retryAvailable
    ? "Try again"
    : reviewReady
      ? "Review change"
      : currentDraftChanged
      ? currentPreviewLoading
          ? "Checking change…"
          : "Check change"
        : exactProjectionUsable && !activeProposalChanged
          ? "No change to review"
        : workbenchUpdating
          ? "Checking change…"
          : "Create a scenario to review";
  const exceptionState = visibleProjection?.state === "ready"
    || visibleProjection?.state === "unchanged"
    ? "available"
    : visibleProjection?.state;
  const liveMessage = showingRetainedProjection
    ? `Rechecking ${activeScenario.guestCount} guests. The previous ${visibleProjectionGuestCount}-guest result is shown until this update finishes.`
    : workbenchUpdating
      ? `Checking this change for ${activeScenario.guestCount} guests.`
      : retryAvailable
        ? "This change could not be checked. Try again."
        : validation?.message || `${activeScenario.name} is selected.`;
  const createdLabel = formatCreatedAt(activeScenario.createdAtISO);
  const scenarioB = snapshot.scenarios.find((scenario) => scenario.slot === "B") || null;

  return (
    <section
      className="commercial-scenario-workbench"
      data-capability-id={COMMERCIAL_SCENARIO_WORKBENCH_CAPABILITY_ID}
      data-capability-state={capabilityState}
      data-authority="session-only-non-authoritative"
      data-scenario-id={activeScenario.scenarioId}
      data-scenario-generation={activeScenario.generation}
      data-scenario-input-digest={activeScenario.inputDigest}
      aria-labelledby="csw-title"
    >
      <header className="csw-header">
        <div className="csw-header__copy">
          <p className="csw-kicker">Commercial review</p>
          <div className="csw-header__title-row">
            <h2 id="csw-title">{currentEventName}</h2>
            {!isCurrent ? <span>{activeScenario.name} · {activeScenario.guestCount} guests</span> : null}
          </div>
          <p className="csw-header__lede">Current commitment · {snapshot.currentScenario.guestCount} guests</p>
          <div className="csw-header__state">
            <strong>{isCurrent ? "Current quote" : "Scenario only · not saved"}</strong>
            <EvidenceException state={exceptionState} />
          </div>
        </div>
        <div className="csw-header__actions" aria-label="Scenario review actions">
          <button
            type="button"
            className="csw-quiet-button"
            disabled={isCurrent}
            onClick={() => actions.selectScenario(snapshot.currentScenario.scenarioId)}
          >Compare Current</button>
          {scenarioB ? (
            <button
              type="button"
              className="csw-quiet-button"
              disabled={scenarioB.scenarioId === activeScenario.scenarioId}
              onClick={() => actions.selectScenario(scenarioB.scenarioId)}
            >Scenario B</button>
          ) : null}
          <button
            type="button"
            className="csw-review-button"
            disabled={primaryDisabled}
            onClick={handleReview}
          >{primaryLabel}</button>
        </div>
      </header>

      <div
        id="csw-active-scenario"
        role="tabpanel"
        aria-label={`${activeScenario.name} commercial review`}
        className="csw-grid"
      >
        <FulfillmentIntelligence
          projection={visibleProjection}
          activeScenario={activeScenario}
          updating={workbenchUpdating}
          retained={showingRetainedProjection}
          constraintOpen={constraintOpen}
          onToggleConstraint={() => setConstraintOpen((current) => !current)}
          onUseSafeThrough={(value) => actions.setGuestCount(value)}
          onOpenStaffing={onOpenStaffing}
          onOpenInventory={inventoryEvidenceAvailable ? onOpenInventory : undefined}
          onRefreshStaffing={onRefreshStaffing}
        />

        <section className="csw-commitment" aria-labelledby="csw-commitment-title">
          <header className="csw-commitment__heading">
            <div>
              <p className="csw-kicker">Current vs {activeScenario.name}</p>
              <h3 id="csw-commitment-title">What changes</h3>
            </div>
            <span>{signedCount(guestDelta)}</span>
          </header>

          <ScenarioComparison
            scenarios={snapshot.scenarios}
            activeScenario={activeScenario}
            visibleProjection={visibleProjection}
            exactProjectionUsable={exactProjectionUsable}
            showingRetainedProjection={showingRetainedProjection}
            workbenchUpdating={workbenchUpdating}
            currentGuestCount={snapshot.currentScenario.guestCount}
          />

          {showingRetainedProjection ? (
            <p className="csw-retained-note">
              Showing the previous result for {guestLabel(visibleProjectionGuestCount)} while this option updates.
            </p>
          ) : null}

          <details className="csw-comparison-disclosure">
            <summary>Menu and BEO details</summary>
            <div className="csw-comparison-disclosure__body">
              <p className="csw-menu-basis">
                <strong>Menu used for this review</strong><br />
                {menuNames.length ? menuNames.join(", ") : "Choose menu items to check ingredient needs."}
              </p>
              <p className="csw-menu-basis">
                BEO · {commercial.evidenceState === "available"
                  ? visibleProjection?.consequences?.beo?.effect === "stale"
                    ? "review required after this change"
                    : "review this document before moving forward"
                  : "not checked for this option"}
              </p>
            </div>
          </details>
        </section>

        <aside className="csw-controls" aria-labelledby="csw-controls-title">
          <div className="csw-controls__heading">
            <div>
              <p className="csw-kicker">Scenario controls</p>
              <h3 id="csw-controls-title">{activeScenario.name}</h3>
            </div>
          </div>
          <div className="csw-tabs" role="tablist" aria-label="Commercial scenarios">
            {snapshot.scenarios.map((scenario, index) => {
              const selected = scenario.scenarioId === activeScenario.scenarioId;
              return (
                <button
                  key={scenario.scenarioId}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`csw-tab-${scenario.scenarioId}`}
                  aria-selected={selected}
                  aria-controls="csw-active-scenario"
                  tabIndex={selected ? 0 : -1}
                  className="csw-tab"
                  onClick={() => actions.selectScenario(scenario.scenarioId)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <strong>{scenario.name}</strong>
                </button>
              );
            })}
          </div>
          <p className="csw-scenario-meta">{createdLabel} · Started from Current</p>

          <div className="csw-guest-control">
            <label htmlFor="csw-guest-count">Working guest count</label>
            <div className="csw-stepper">
              <button
                type="button"
                aria-label="Decrease guest count by one"
                disabled={activeScenario.guestCount <= 1}
                onClick={() => actions.stepGuestCount(-1)}
              >−</button>
              <input
                id="csw-guest-count"
                type="number"
                inputMode="numeric"
                min="1"
                max="400"
                step="1"
                value={guestDraft}
                aria-invalid={Boolean(validation) || undefined}
                aria-describedby={validation ? "csw-guest-validation" : "csw-guest-hint"}
                onChange={(event) => handleGuestDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setGuestDraft(String(activeScenario.guestCount));
                    actions.setGuestCount(activeScenario.guestCount);
                    event.currentTarget.blur();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Increase guest count by one"
                disabled={activeScenario.guestCount >= 400}
                onClick={() => actions.stepGuestCount(1)}
              >+</button>
            </div>
            {validation ? (
              <p id="csw-guest-validation" className="csw-validation">{validation.message}</p>
            ) : (
              <p id="csw-guest-hint" className="csw-guest-control__hint">Use 1–400 guests. Changing Current starts Scenario A.</p>
            )}
          </div>

          <div className="csw-quick-adjustments" aria-label="Quick guest adjustments">
            {[10, 25, 50].map((delta) => (
              <button
                key={delta}
                type="button"
                disabled={activeScenario.guestCount + delta > 400}
                onClick={() => actions.stepGuestCount(delta)}
              >+{delta}</button>
            ))}
          </div>

          <div className="csw-scenario-actions">
            <button
              type="button"
              className="csw-quiet-button"
              disabled={!canDuplicate}
              onClick={() => actions.duplicateScenario()}
            >Duplicate scenario</button>
            <p className="csw-scenario-capacity">Compare Current with up to two options. Changes stay on this screen until reviewed.</p>
          </div>
        </aside>

      </div>

      <p className="csw-live-status" role="status" aria-live="polite">{liveMessage}</p>

      {retryAvailable ? (
        <p className="csw-recovery" role="alert">
          <strong>This change could not be checked.</strong>{" "}
          Try again before relying on this comparison.
        </p>
      ) : null}

      <footer className="csw-footer">
        <div className="csw-footer__boundary">
          <strong>No changes saved</strong>
          <span>Pricing, staffing, inventory, and the BEO are unchanged.</span>
        </div>
        <div className="csw-footer__actions">
          {!isCurrent ? (
            <button
              type="button"
              className="csw-quiet-button"
              onClick={() => actions.discardScenario(activeScenario.scenarioId)}
            >Discard scenario</button>
          ) : null}
        </div>
      </footer>

      <details className="csw-evidence-boundary">
        <summary>About this comparison</summary>
        <div className="csw-evidence-boundary__body">
          <p>This is a planning comparison. It does not change the quote or reserve staff or stock.</p>
          <p>Pricing, staffing, inventory, and BEO updates still require their normal review steps.</p>
        </div>
      </details>
    </section>
  );
}

export default function CommercialScenarioWorkbench({
  projection,
  scopeKey,
  baseQuoteRevisionId,
  currentGuestCount,
  proposedGuestCount,
  ...props
}) {
  const currentCandidate = currentGuestCount ?? projection?.scenario?.currentGuestCount;
  const proposedCandidate = proposedGuestCount ?? projection?.scenario?.proposedGuestCount;
  const resolvedCurrentGuestCount = validGuestCount(currentCandidate);
  const resolvedProposedGuestCount = proposedCandidate ?? resolvedCurrentGuestCount;
  const resolvedBaseRevisionId = text(baseQuoteRevisionId)
    || text(projection?.fulfillment?.identity?.quoteRevisionId);
  const identity = projection?.fulfillment?.identity || {};
  const derivedScopeKey = text(identity.organizationId) && text(identity.quoteId)
    ? `${text(identity.organizationId)}:${text(identity.quoteId)}:${resolvedBaseRevisionId}`
    : "";
  const resolvedScopeKey = text(scopeKey) || derivedScopeKey;

  if (resolvedCurrentGuestCount === null || !resolvedBaseRevisionId || !resolvedScopeKey) {
    return (
      <section
        className="commercial-scenario-workbench commercial-scenario-workbench--unavailable"
        data-capability-id={COMMERCIAL_SCENARIO_WORKBENCH_CAPABILITY_ID}
        data-authority="session-only-non-authoritative"
        data-capability-state="unavailable"
        aria-labelledby="csw-unavailable-title"
      >
        <p className="csw-kicker">Commercial review</p>
        <h2 id="csw-unavailable-title">This comparison is not ready yet</h2>
        <p>
          Add a current guest count and save the quote, then try this comparison again.
        </p>
        {typeof props.onReviewForCommitment === "function" ? (
          <button
            type="button"
            className="csw-quiet-button"
            onClick={() => props.onReviewForCommitment({ reason: "incomplete_scenario_authority" })}
          >Review current quote</button>
        ) : null}
      </section>
    );
  }

  return (
    <CommercialScenarioWorkbenchReady
      key={`${resolvedScopeKey}\u0000${resolvedBaseRevisionId}\u0000${resolvedCurrentGuestCount}`}
      {...props}
      projection={projection}
      resolvedScopeKey={resolvedScopeKey}
      resolvedBaseRevisionId={resolvedBaseRevisionId}
      resolvedCurrentGuestCount={resolvedCurrentGuestCount}
      resolvedProposedGuestCount={resolvedProposedGuestCount}
    />
  );
}
