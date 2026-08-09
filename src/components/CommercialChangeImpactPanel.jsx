import StatusChip from "./StatusChip";
import { COMMERCIAL_CHANGE_IMPACT_BOUNDARY } from "../lib/commercialChangeImpact";
import {
  formatWorkspaceInteger,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const STATE_PRESENTATION = Object.freeze({
  loading: { family: "info", label: "Simulating impact" },
  recovery: { family: "action", label: "Retrying simulation" },
  empty: { family: "info", label: "No declared change" },
  success: { family: "confirmed", label: "Simulation ready" },
  partial: { family: "action", label: "Bounded simulation" },
  error: { family: "failed", label: "Simulation unavailable" },
  stale: { family: "action", label: "Prior simulation retained" }
});

function text(value) {
  return String(value ?? "").trim();
}

function hasSimulation(model) {
  return Boolean(
    model
    && typeof model === "object"
    && !Array.isArray(model)
    && model.identity
    && model.sources
    && model.graph
    && model.commercialValues
    && model.impact
    && model.bounds
    && Array.isArray(model.factDiffs)
    && Array.isArray(model.impact.dependentNodes)
  );
}

function simulationIsEmpty(model) {
  if (!hasSimulation(model)) return false;
  return model.factDiffs.length === 0
    && model.impact.dependentNodes.length === 0
    && model.commercialValues?.authoritativeTotal?.changed !== true
    && model.commercialValues?.depositRequirement?.changed !== true;
}

export function buildCommercialChangeImpactPanelState({
  model = null,
  loading = false,
  recovering = false,
  error = "",
  partial = false
} = {}) {
  const snapshotAvailable = hasSimulation(model);
  let state = "success";
  if (recovering) state = "recovery";
  else if (loading) state = "loading";
  else if (text(error) && snapshotAvailable) state = "stale";
  else if (text(error) || !snapshotAvailable) state = "error";
  else if (partial) state = "partial";
  else if (simulationIsEmpty(model)) state = "empty";

  const retained = snapshotAvailable && ["loading", "recovery", "stale"].includes(state);
  const detail = {
    loading: retained
      ? "Preparing a new read-only simulation; the prior completed result remains visible until it is replaced."
      : "Preparing a read-only simulation from authoritative before and proposed-after snapshots.",
    recovery: retained
      ? "Retrying the authoritative simulation; the prior completed result remains visible until reconciliation finishes."
      : "Retrying the authoritative read-only simulation after a failed attempt.",
    empty: "The supplied authoritative values contain no declared commercial change for this graph.",
    success: "The deterministic change impact is ready for staff review.",
    partial: "Only a bounded partial simulation is visible. Do not authorize or publish from this view.",
    error: "Change impact could not be simulated, and no prior completed result is available.",
    stale: "The latest simulation failed. The prior completed result remains visible and may be stale."
  }[state];

  return {
    state,
    detail,
    retained,
    snapshotAvailable,
    presentation: STATE_PRESENTATION[state]
  };
}

function formatCurrency(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Amount unavailable";
  const normalizedCurrency = /^[A-Z]{3}$/.test(text(currency)) ? text(currency) : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
}

function formatSignedCurrency(before, proposedAfter, currency) {
  const beforeAmount = Number(before);
  const afterAmount = Number(proposedAfter);
  if (!Number.isFinite(beforeAmount) || !Number.isFinite(afterAmount)) return "Delta unavailable";
  const delta = afterAmount - beforeAmount;
  const formatted = formatCurrency(Math.abs(delta), currency);
  if (delta > 0) return `+${formatted}`;
  if (delta < 0) return `−${formatted}`;
  return formatCurrency(0, currency);
}

function exactFactValue(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (["number", "boolean"].includes(typeof value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "Value unavailable";
  }
}

function factLabel(nodeId) {
  return humanizeWorkspaceValue(text(nodeId).replace(/^fact\./, ""), {
    emptyLabel: "Changed fact"
  });
}

function dependencyLabel(nodeId) {
  return humanizeWorkspaceValue(text(nodeId).replace(/^[^.]+\./, ""), {
    emptyLabel: "Dependent decision"
  });
}

function sourceLabel(source) {
  return humanizeWorkspaceValue(source?.label, { emptyLabel: "Source unavailable" });
}

function authorityLabel(source) {
  return humanizeWorkspaceValue(source?.authority, { emptyLabel: "Authority unavailable" });
}

function CommercialDelta({ model }) {
  const values = model.commercialValues || {};
  const currency = text(values.currency) || "USD";
  const total = values.authoritativeTotal || {};
  const deposit = values.depositRequirement || {};

  return (
    <section className="workflow-form-section" aria-labelledby="commercial-change-impact-money-title">
      <h4 id="commercial-change-impact-money-title">Commercial delta</h4>
      <div className="workflow-metrics" aria-label="Authoritative commercial values before and after the proposed change">
        <div>
          <span>Total before</span>
          <strong>{formatCurrency(total.before, currency)}</strong>
        </div>
        <div>
          <span>Proposed total</span>
          <strong>{formatCurrency(total.proposedAfter, currency)}</strong>
        </div>
        <div>
          <span>Total change</span>
          <strong>{formatSignedCurrency(total.before, total.proposedAfter, currency)}</strong>
        </div>
        <div>
          <span>
            Deposit change · {formatCurrency(deposit.before, currency)} → {formatCurrency(deposit.proposedAfter, currency)}
          </span>
          <strong>{formatSignedCurrency(deposit.before, deposit.proposedAfter, currency)}</strong>
        </div>
      </div>
      <p className="source-note">
        Total: {total.changed === true ? "changed" : "unchanged"} · Deposit requirement: {deposit.changed === true ? "changed" : "unchanged"} · Currency: {currency}
      </p>
      <p className="staff-evidence-caveat">
        Pricing sources: <code>{formatWorkspaceText(total.beforeSourceLabel, { emptyLabel: "Unavailable" })}</code> → <code>{formatWorkspaceText(total.proposedAfterSourceLabel, { emptyLabel: "Unavailable" })}</code>. Authority: <code>{formatWorkspaceText(total.authority, { emptyLabel: "Unavailable" })}</code>.
      </p>
    </section>
  );
}

function FactDiffs({ factDiffs }) {
  return (
    <section className="workflow-form-section" aria-labelledby="commercial-change-impact-facts-title">
      <h4 id="commercial-change-impact-facts-title">Exact fact changes</h4>
      {factDiffs.length === 0 ? (
        <p className="muted">No declared fact changed in this simulation.</p>
      ) : (
        <div className="quote-version-comparison-sections">
          <dl>
            {factDiffs.map((diff) => (
              <div key={diff.nodeId} data-change-fact={diff.nodeId}>
                <dt>
                  {factLabel(diff.nodeId)}
                  <br />
                  <small><code>{diff.nodeId}</code></small>
                </dt>
                <dd>
                  <span>Before: <code data-value-side="before">{exactFactValue(diff.before)}</code></span>
                  <span>Proposed: <code data-value-side="proposed-after">{exactFactValue(diff.proposedAfter)}</code></span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function DependencyList({ title, titleId, advisoryClass, items }) {
  const isStale = advisoryClass === "STALE";
  return (
    <section className="workflow-form-section" aria-labelledby={titleId} data-advisory-class={advisoryClass}>
      <h4 id={titleId}>{title}</h4>
      {items.length === 0 ? (
        <p className="muted">
          {isStale
            ? "No generated artifact or projection is classified STALE by this simulation."
            : "No dependent decision is classified REVIEW by this simulation."}
        </p>
      ) : (
        <ol className="command-center-list">
          {items.map((node) => (
            <li className="command-center-row" key={node.id} data-dependent-node={node.id}>
              <div className="command-center-row-main">
                <strong>{dependencyLabel(node.id)}</strong>
                <p className="command-center-row-detail"><code>{node.id}</code></p>
                <p className="command-center-row-meta">
                  {humanizeWorkspaceValue(node.kind, { emptyLabel: "Dependency" })} · Distance {formatWorkspaceInteger(node.distance)}
                </p>
                <p className="command-center-row-meta">
                  Triggered by: {(Array.isArray(node.triggeredBy) ? node.triggeredBy : []).join(", ") || "Source unavailable"}
                </p>
              </div>
              <StatusChip family={isStale ? "pending" : "action"} label={advisoryClass} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SimulationEvidence({ model }) {
  const factDiffs = Array.isArray(model.factDiffs) ? model.factDiffs : [];
  const dependents = Array.isArray(model.impact?.dependentNodes)
    ? model.impact.dependentNodes
    : [];
  const reviewItems = dependents.filter((node) => node.advisoryClass === "REVIEW");
  const staleItems = dependents.filter((node) => node.advisoryClass === "STALE");
  const identity = model.identity || {};
  const bounds = model.bounds || {};

  return (
    <>
      <dl className="staff-evidence-details">
        <div>
          <dt>Quote scope</dt>
          <dd><code>{formatWorkspaceText(identity.quoteId, { emptyLabel: "Unavailable" })}</code><small>Tenant: <code>{formatWorkspaceText(identity.organizationId, { emptyLabel: "Unavailable" })}</code></small></dd>
        </div>
        <div>
          <dt>Before source</dt>
          <dd>{sourceLabel(model.sources?.before)}<small><code>{formatWorkspaceText(model.sources?.before?.label, { emptyLabel: "Unavailable" })}</code> · {authorityLabel(model.sources?.before)} · revision <code>{formatWorkspaceText(identity.beforeRevisionId, { emptyLabel: "Unavailable" })}</code></small></dd>
        </div>
        <div>
          <dt>Proposed source</dt>
          <dd>{sourceLabel(model.sources?.proposedAfter)}<small><code>{formatWorkspaceText(model.sources?.proposedAfter?.label, { emptyLabel: "Unavailable" })}</code> · {authorityLabel(model.sources?.proposedAfter)} · revision <code>{formatWorkspaceText(identity.proposedRevisionId, { emptyLabel: "Unavailable" })}</code></small></dd>
        </div>
        <div>
          <dt>Dependency graph</dt>
          <dd><code>{formatWorkspaceText(model.graph?.graphId, { emptyLabel: "Unavailable" })}</code><small>Version <code>{formatWorkspaceText(model.graph?.graphVersion, { emptyLabel: "Unavailable" })}</code></small></dd>
        </div>
        <div>
          <dt>Simulation bounds</dt>
          <dd>{formatWorkspaceInteger(factDiffs.length)} of {formatWorkspaceInteger(bounds.changedFactLimit)} changed facts<small>{formatWorkspaceInteger(dependents.length)} of {formatWorkspaceInteger(bounds.dependentNodeLimit)} dependents · {formatWorkspaceInteger(bounds.declaredFactCount)} declared facts · {formatWorkspaceInteger(bounds.outputByteLimit)} byte output limit</small></dd>
        </div>
      </dl>

      <CommercialDelta model={model} />
      <FactDiffs factDiffs={factDiffs} />

      <section className="workflow-form-section" aria-labelledby="commercial-change-impact-dependents-title">
        <h4 id="commercial-change-impact-dependents-title">Dependent decisions & artifacts</h4>
        <p className="staff-evidence-bounds-note">
          {formatWorkspaceInteger(model.impact?.counts?.review)} REVIEW · {formatWorkspaceInteger(model.impact?.counts?.stale)} STALE · {formatWorkspaceInteger(model.impact?.counts?.total)} total dependent results
        </p>
        <div className="workflow-form-grid">
          <DependencyList
            title="Requires review"
            titleId="commercial-change-impact-review-title"
            advisoryClass="REVIEW"
            items={reviewItems}
          />
          <DependencyList
            title="Projected stale"
            titleId="commercial-change-impact-stale-title"
            advisoryClass="STALE"
            items={staleItems}
          />
        </div>
      </section>
    </>
  );
}

export default function CommercialChangeImpactPanel({
  model = null,
  loading = false,
  recovering = false,
  error = "",
  partial = false,
  onRetry,
  onReturnToEdit,
  titleId = "commercial-change-impact-title"
}) {
  const view = buildCommercialChangeImpactPanelState({ model, loading, recovering, error, partial });
  const visualState = view.state === "error" ? "unavailable" : view.state;
  const stateRole = ["error", "stale", "partial"].includes(view.state) ? "alert" : "status";
  const boundary = text(model?.boundary)
    || COMMERCIAL_CHANGE_IMPACT_BOUNDARY;

  return (
    <section
      className={`staff-evidence-rail staff-evidence-${visualState}`}
      aria-labelledby={titleId}
      aria-busy={loading || recovering}
      data-capability-id="cwf-15b-commercial-change-impact-presentation"
      data-capability-state={view.state}
      data-read-truncation={view.snapshotAvailable ? (partial ? "truncated" : "complete") : "unknown"}
      data-simulation-mode="read-only-advisory"
    >
      <div className="staff-evidence-head">
        <div>
          <p className="eyebrow">Commercial dependency graph · simulation only</p>
          <h3 id={titleId}>Change Impact</h3>
        </div>
        <div className="right-actions">
          <StatusChip {...view.presentation} />
          {typeof onRetry === "function" && ["error", "stale"].includes(view.state) && (
            <button
              type="button"
              className="ghost compact"
              data-capability-action="retry-simulation"
              onClick={onRetry}
            >
              Retry preview
            </button>
          )}
          {typeof onReturnToEdit === "function" && (
            <button
              type="button"
              className="ghost compact"
              data-capability-action="return-to-edit"
              onClick={onReturnToEdit}
            >
              Return to edit
            </button>
          )}
        </div>
      </div>

      <p className="staff-evidence-outcome" role={stateRole} aria-live="polite" aria-atomic="true">
        {view.detail}
      </p>

      <p className="workflow-attention-boundary" role="note" data-simulation-boundary="authorization-reconciliation-publication">
        <strong>Simulation only — authorization and reconciliation are required.</strong>{" "}
        Nothing is invalidated, regenerated, or published here. {boundary}
      </p>

      {view.snapshotAvailable && <SimulationEvidence model={model} />}
    </section>
  );
}
