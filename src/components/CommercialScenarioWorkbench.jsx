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
  if (!value) return "Current revision";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Session scenario";
  return `Created ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date)}`;
}

function formatEventDate(value) {
  const candidate = text(value);
  if (!candidate) return "";
  const date = new Date(`${candidate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return candidate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function evidenceLabel(state) {
  return ({
    missing: "Missing evidence",
    not_yet_available: "Not yet available",
    blocked_by_integration: "Integration blocked",
    contradictory: "Contradictory evidence",
    schema_drift: "Schema changed",
    stale: "Stale evidence",
    partial: "Partial evidence",
    failed: "Evidence failed",
    error: "Evidence failed",
    unavailable: "Unavailable",
    unknown: "Unknown"
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

function sourceRevision(value, preferredKeys = []) {
  if (!value || typeof value !== "object") return text(value) || "Not supplied";
  const sources = [value, value.proposedAfter, value.before]
    .filter((entry) => entry && typeof entry === "object");
  for (const source of sources) {
    for (const key of preferredKeys) {
      if (source[key] !== undefined && source[key] !== null && text(source[key])) {
        return text(source[key]);
      }
    }
  }
  return "Not supplied";
}

function CurrentWorkingComparison({ projection }) {
  const commercial = projection?.consequences?.commercial || {};
  const inventory = projection?.consequences?.inventory || {};
  const currency = commercial.currency || inventory.cost?.currency || "USD";
  const rows = [
    {
      label: "Quote total",
      current: formatMoney(commercial.total?.before, currency),
      working: formatMoney(commercial.total?.proposedAfter, currency),
      difference: signedMoney(commercial.total?.delta, currency)
    },
    {
      label: "Deposit",
      current: formatMoney(commercial.depositRequirement?.before, currency),
      working: formatMoney(commercial.depositRequirement?.proposedAfter, currency),
      difference: signedMoney(commercial.depositRequirement?.delta, currency)
    },
    {
      label: "Ingredient cost",
      current: formatMoney(inventory.cost?.beforeMinor, inventory.cost?.currency, { minor: true }),
      working: formatMoney(inventory.cost?.proposedAfterMinor, inventory.cost?.currency, { minor: true }),
      difference: signedMoney(inventory.cost?.deltaMinor, inventory.cost?.currency, { minor: true })
    }
  ];
  return (
    <table className="csw-comparison">
      <caption className="visually-hidden">Current and working commercial comparison</caption>
      <thead>
        <tr><th scope="col">Measure</th><th scope="col">Current</th><th scope="col">Working</th><th scope="col">Difference</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td data-column="Current">{row.current}</td>
            <td data-column="Working">{row.working}</td>
            <td data-column="Difference">{row.difference}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  eventDate = "",
  eventTime = "",
  venue = "",
  proposedEventName = "",
  proposedEventDate = "",
  proposedEventTime = "",
  proposedVenue = "",
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
  const currentIdentity = {
    name: text(eventName),
    date: text(eventDate),
    time: text(eventTime),
    venue: text(venue)
  };
  const workingIdentity = {
    name: text(proposedEventName) || currentIdentity.name,
    date: text(proposedEventDate) || currentIdentity.date,
    time: text(proposedEventTime) || currentIdentity.time,
    venue: text(proposedVenue) || currentIdentity.venue
  };
  const workingIdentityChanged = Object.keys(currentIdentity)
    .some((key) => workingIdentity[key] !== currentIdentity[key]);
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
    ? "Retry exact evidence"
    : reviewReady
      ? "Review for commitment"
      : currentDraftChanged
      ? currentPreviewLoading
          ? "Updating exact evidence…"
          : "Preview consequences"
        : exactProjectionUsable && !activeProposalChanged
          ? "No change to review"
        : workbenchUpdating
          ? "Updating exact evidence…"
          : "Create a scenario to review";
  const exceptionState = visibleProjection?.state === "ready"
    || visibleProjection?.state === "unchanged"
    ? "available"
    : visibleProjection?.state;
  const liveMessage = showingRetainedProjection
    ? `Updating consequences for ${activeScenario.guestCount} guests. The last accepted ${visibleProjectionGuestCount}-guest result remains visible and is labeled retained.`
    : workbenchUpdating
      ? `Updating consequences for ${activeScenario.guestCount} guests.`
      : retryAvailable
        ? projection?.provenance?.previewError || "Exact consequence evidence needs recovery."
        : validation?.message || `${activeScenario.name} is current in this session view.`;
  const createdLabel = formatCreatedAt(activeScenario.createdAtISO);

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
        <div>
          <p className="csw-kicker">Living Commercial Twin · Scenario Workbench</p>
          <h3 id="csw-title">Explore the commitment before you make it</h3>
        </div>
        <div className="csw-header__state">
          <strong>Session only · not committed</strong>
          <span>Current revision stays intact</span>
          <EvidenceException state={exceptionState} />
        </div>
      </header>

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
              <strong>{selected && scenario.kind === "working" ? <span className="csw-tab__dot" aria-hidden="true" /> : null}{scenario.name}</strong>
              <small>{scenario.guestCount} guests{scenario.kind === "working" ? ` · g${scenario.generation}` : " · saved"}</small>
            </button>
          );
        })}
      </div>

      <div
        id="csw-active-scenario"
        role="tabpanel"
        aria-labelledby={`csw-tab-${activeScenario.scenarioId}`}
        className="csw-grid"
      >
        <section className="csw-commitment" aria-labelledby="csw-commitment-title">
          <div className="csw-commitment__identity">
            <p className="csw-kicker">Living commitment · Current saved</p>
            <h4 id="csw-commitment-title">{currentIdentity.name || "Current event commitment"}</h4>
            <p className="csw-event-meta">
              {formatEventDate(currentIdentity.date) ? <span>{formatEventDate(currentIdentity.date)}</span> : null}
              {currentIdentity.time ? <span>{currentIdentity.time}</span> : null}
              {currentIdentity.venue ? <span>{currentIdentity.venue}</span> : null}
            </p>
          </div>

          {workingIdentityChanged ? (
            <div className="csw-working-identity" aria-label="Working event detail changes">
              <span>Working event details</span>
              <strong>{workingIdentity.name || "Unnamed event"}</strong>
              <small>{[
                formatEventDate(workingIdentity.date),
                workingIdentity.time,
                workingIdentity.venue
              ].filter(Boolean).join(" · ") || "No event details supplied"}</small>
            </div>
          ) : null}

          <div className="csw-guest-delta">
            <div>
              <span>Current</span>
              <strong>{snapshot.currentScenario.guestCount}</strong>
              <small>saved guests</small>
            </div>
            <span className="csw-guest-delta__arrow" aria-hidden="true">→</span>
            <div className="csw-value-settle" key={`${activeScenario.scenarioId}-${activeScenario.generation}`}>
              <span>Working</span>
              <strong>{activeScenario.guestCount}</strong>
              <small>{signedCount(guestDelta)}</small>
            </div>
          </div>

          {showingRetainedProjection ? (
            <p className="csw-retained-note">
              Retained exact result for {guestLabel(visibleProjectionGuestCount)}. New consequences are updating; this result is not labeled current.
            </p>
          ) : null}

          <CurrentWorkingComparison projection={visibleProjection} />

          <p className="csw-menu-basis">
            <strong>Menu basis</strong><br />
            {menuNames.length
              ? menuNames.join(", ")
              : "No saved menu selection is available for ingredient evaluation."}
          </p>
          <p className="csw-menu-basis">
            Kitchen BEO · {commercial.evidenceState === "available"
              ? visibleProjection?.consequences?.beo?.effect === "stale"
                ? "freshness review required after commitment"
                : "review dependency carried from the exact preview"
              : "not yet evaluated for this scenario"}
          </p>
        </section>

        <aside className="csw-controls" aria-labelledby="csw-controls-title">
          <div className="csw-controls__heading">
            <div>
              <p className="csw-kicker">Scenario controls</p>
              <h4 id="csw-controls-title">{activeScenario.name}</h4>
            </div>
            <span className="csw-scenario-meta">g{activeScenario.generation}</span>
          </div>
          <p className="csw-scenario-meta">{createdLabel}<br />Based on {text(activeScenario.baseQuoteRevisionId) || "the current revision"}</p>

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
              <p id="csw-guest-hint" className="csw-guest-control__hint">Whole guests, 1–400. Editing Current creates Scenario A.</p>
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
            <p className="csw-scenario-capacity">Current + up to two temporary alternatives. Nothing is persisted.</p>
          </div>
        </aside>

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
      </div>

      <p className="csw-live-status" role="status" aria-live="polite">{liveMessage}</p>

      {retryAvailable ? (
        <p className="csw-recovery" role="alert">
          <strong>Exact consequence evidence needs recovery.</strong>{" "}
          {projection?.provenance?.previewError || "Retry this scenario request before relying on its comparison."}
        </p>
      ) : null}

      <footer className="csw-footer">
        <div className="csw-footer__boundary">
          <strong>Reversibility · Full · Not committed</strong>
          <span>Nothing here has changed Commercial, Staffing, Inventory, or BEO authority.</span>
        </div>
        <div className="csw-footer__actions">
          {!isCurrent ? (
            <button
              type="button"
              className="csw-quiet-button"
              onClick={() => actions.discardScenario(activeScenario.scenarioId)}
            >Discard scenario</button>
          ) : null}
          <button
            type="button"
            className="csw-review-button"
            disabled={primaryDisabled}
            onClick={handleReview}
          >{primaryLabel}</button>
        </div>
      </footer>

      <details className="csw-evidence-boundary">
        <summary>Scenario identity, authority, and evidence boundary</summary>
        <div className="csw-evidence-boundary__body">
          <p>{snapshot.boundary}</p>
          <p>{visibleProjection?.boundary || "Commercial, Staffing, and Inventory remain separate authorities; Fulfillment is a rebuildable read model."}</p>
          <dl>
            <div><dt>Scenario</dt><dd>{activeScenario.scenarioId} · generation {activeScenario.generation}<br />{activeScenario.inputDigest}</dd></div>
            <div><dt>People source</dt><dd>{sourceRevision(visibleProjection?.fulfillment?.sourceRevisions?.people, ["planRevision", "authorityVersion", "quoteRevisionId"])}</dd></div>
            <div><dt>Supply source</dt><dd>{sourceRevision(visibleProjection?.fulfillment?.sourceRevisions?.supply, ["projectionDigest", "eventRequirementRevisionId", "requirementRevision", "sourceFingerprint"])}</dd></div>
          </dl>
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
        <p className="csw-kicker">Living Commercial Twin · Scenario Workbench</p>
        <h3 id="csw-unavailable-title">A scenario cannot be created from incomplete authority</h3>
        <p>
          The current saved guest count, base quote revision, and quote scope are required.
          No temporary scenario or consequence request was created.
        </p>
        {typeof props.onReviewForCommitment === "function" ? (
          <button
            type="button"
            className="csw-quiet-button"
            onClick={() => props.onReviewForCommitment({ reason: "incomplete_scenario_authority" })}
          >Review current quote evidence</button>
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
