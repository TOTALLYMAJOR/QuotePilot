import { useEffect, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import ShimmerReveal from "./ShimmerReveal";
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

const AUTHORITY_MUTATION_PRESENTATION = Object.freeze({
  ready: { family: "info", label: "Review required" },
  submitting: { family: "pending", label: "Submitting exact request" },
  reconciliation: { family: "pending", label: "Reconciling exact request" },
  pending: { family: "action", label: "Authorization pending" },
  authorized: { family: "confirmed", label: "Authorized" },
  applying: { family: "pending", label: "Applying atomically" },
  receipt: { family: "confirmed", label: "Receipt recorded" },
  uncertain: { family: "blocked", label: "Outcome uncertain" },
  error: { family: "failed", label: "Request rejected" },
  recovery: { family: "action", label: "Corrected request ready" }
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

// Direction of the proposed change's effect on net cash, derived from the
// server-authoritative total. Exported for tests.
export function commercialRevealTone(model) {
  const total = model?.commercialValues?.authoritativeTotal || {};
  const before = Number(total.before);
  const after = Number(total.proposedAfter);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "neutral";
  if (after > before) return "positive";
  if (after < before) return "negative";
  return "neutral";
}

// One-shot shimmer reveal fired when a fresh simulation becomes relevant.
// Hook state lives in this child (not the panel) so the panel stays callable
// as a plain function, which the existing element-tree tests rely on.
function CommercialImpactShimmer({ model, state, snapshotAvailable }) {
  const [reveal, setReveal] = useState({ run: 0, tone: "neutral" });
  const revealedModelRef = useRef(null);
  useEffect(() => {
    const ready = ["success", "partial"].includes(state) && snapshotAvailable;
    if (!ready || revealedModelRef.current === model) return;
    revealedModelRef.current = model;
    setReveal((prev) => ({ run: prev.run + 1, tone: commercialRevealTone(model) }));
  }, [state, snapshotAvailable, model]);
  return <ShimmerReveal trigger={reveal.run} tone={reveal.tone} />;
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
            <li
              className="command-center-row"
              key={node.id || node.nodeId}
              data-dependent-node={node.id || node.nodeId}
            >
              <div className="command-center-row-main">
                <strong>{dependencyLabel(node.id || node.nodeId)}</strong>
                <p className="command-center-row-detail"><code>{node.id || node.nodeId}</code></p>
                <p className="command-center-row-meta">
                  {humanizeWorkspaceValue(node.kind || node.nodeKind, { emptyLabel: "Dependency" })} · Distance {formatWorkspaceInteger(node.distance)}
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
  const reviewItems = dependents.filter((node) => (
    (node.advisoryClass || node.classification) === "REVIEW"
  ));
  const staleItems = dependents.filter((node) => (
    (node.advisoryClass || node.classification) === "STALE"
  ));
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

function CommercialChangeAuthorityControls({
  authorityState = "",
  authorizationRequired = false,
  staffRole = "sales",
  approval = null,
  authorizationReceiptId = "",
  mutationState = "ready",
  mutationKind = "",
  mutationMessage = "",
  applyResult = null,
  applyOutcome = null,
  scopeCurrent = false,
  onRequestAuthorization,
  onRefreshAuthorization,
  onAuthorize,
  onApply,
  onReconcileApplyOutcome,
  onRecoverApply
}) {
  const normalizedAuthority = text(authorityState).toLowerCase();
  const normalizedMutation = text(mutationState).toLowerCase();
  const outcomeReceiptRef = useRef(null);
  const focusedOutcomeReceiptRef = useRef("");
  const mutationPresentation = AUTHORITY_MUTATION_PRESENTATION[normalizedMutation]
    || AUTHORITY_MUTATION_PRESENTATION.error;
  const approvalState = text(approval?.state).toLowerCase();
  const isAdmin = text(staffRole).toLowerCase() === "admin";
  const busy = ["submitting", "reconciliation", "applying", "recovery"].includes(normalizedMutation);
  const applyOutcomeUncertain = normalizedMutation === "uncertain" && mutationKind === "apply";
  const applyOutcomeRecoverable = normalizedMutation === "recovery"
    && mutationKind === "apply"
    && applyOutcome?.state === "not_committed";
  const authorized = Boolean(authorizationReceiptId) || approvalState === "authorized";
  const canMutate = normalizedAuthority === "enforced" && scopeCurrent && !busy;

  useEffect(() => {
    const receiptId = text(applyOutcome?.outcomeReceiptId);
    if (
      !receiptId
      || focusedOutcomeReceiptRef.current === receiptId
      || !["receipt", "recovery"].includes(normalizedMutation)
    ) return;
    focusedOutcomeReceiptRef.current = receiptId;
    outcomeReceiptRef.current?.focus({ preventScroll: true });
  }, [applyOutcome?.outcomeReceiptId, normalizedMutation]);

  if (!normalizedAuthority) return null;

  return (
    <section
      className="workflow-form-section commercial-change-authority-controls"
      aria-labelledby="commercial-change-authority-title"
      data-capability-id="cwf-15c-commercial-change-authority"
      data-capability-state={normalizedMutation}
      data-authority-state={normalizedAuthority}
    >
      <div className="workflow-attention-head">
        <div>
          <p className="eyebrow">Authorization & atomic apply</p>
          <h4 id="commercial-change-authority-title">Govern this exact change</h4>
        </div>
        <StatusChip {...mutationPresentation} />
      </div>

      {normalizedAuthority !== "enforced" ? (
        <p className="warning-note" role="status">
          Commercial-change enforcement is dormant for this workspace. This trusted receipt is review evidence only; ordinary quote saving remains on the existing edit path until both server and tenant gates are promoted.
        </p>
      ) : !authorizationRequired ? (
        <p className="source-note" role="status">
          The server found no governed dependency impact. No administrator authorization receipt is required; use the normal Save Changes action.
        </p>
      ) : (
        <>
          <p className={scopeCurrent ? "source-note" : "warning-note"} role={scopeCurrent ? "status" : "alert"}>
            {scopeCurrent
              ? "The simulation still matches the unsaved form and saved base revision. Authorization is scoped to this exact evidence."
              : "The unsaved form or saved revision changed after simulation. Authorization and apply are disabled until you re-simulate."}
          </p>

          <dl className="staff-evidence-details">
            <div>
              <dt>Approval state</dt>
              <dd>{humanizeWorkspaceValue(approvalState, { emptyLabel: "Not requested" })}<small>{approval?.approvalRequestId ? <code>{approval.approvalRequestId}</code> : "No approval request receipt"}</small></dd>
            </div>
            <div>
              <dt>Authorization receipt</dt>
              <dd>{authorizationReceiptId ? "Exact receipt ready" : "Not authorized"}<small>{authorizationReceiptId ? <code>{authorizationReceiptId}</code> : "No authorization may be inferred"}</small></dd>
            </div>
          </dl>

          {mutationMessage && (
            <p
              className={["uncertain", "error"].includes(normalizedMutation) ? "warning-note" : "source-note"}
              role={["uncertain", "error"].includes(normalizedMutation) ? "alert" : "status"}
            >
              {mutationMessage}
            </p>
          )}

          <div className="right-actions">
            {!authorized && isAdmin && typeof onAuthorize === "function" && (
              <button
                type="button"
                className="cta compact"
                onClick={onAuthorize}
                disabled={!canMutate}
                title={scopeCurrent ? "Authorize this exact simulation as an administrator." : "Re-simulate the current form before authorizing."}
              >
                {normalizedMutation === "submitting" && mutationKind === "authorization"
                  ? "Authorizing…"
                  : "Authorize exact change"}
              </button>
            )}
            {!authorized && !isAdmin && !approvalState && typeof onRequestAuthorization === "function" && (
              <button
                type="button"
                className="cta compact"
                onClick={onRequestAuthorization}
                disabled={!canMutate}
              >
                Request admin authorization
              </button>
            )}
            {!authorized && approvalState === "pending" && typeof onRefreshAuthorization === "function" && (
              <button
                type="button"
                className="ghost compact"
                onClick={onRefreshAuthorization}
                disabled={!canMutate}
              >
                Refresh approval state
              </button>
            )}
            {authorized && typeof onApply === "function" && (
              <button
                type="button"
                className="cta compact"
                onClick={onApply}
                disabled={!canMutate || applyOutcomeUncertain || Boolean(applyResult)}
                title={applyOutcomeUncertain
                  ? "The prior outcome is unresolved. Reconcile this exact request; this screen will not submit the edit again."
                  : scopeCurrent
                    ? "Apply this authorized edit and create named invalidations atomically."
                    : "Re-simulate before applying."}
              >
                {normalizedMutation === "applying"
                  ? "Applying authorized change…"
                  : applyOutcomeUncertain
                    ? "Apply outcome unresolved"
                    : applyResult
                      ? "Authorized change applied"
                      : "Apply authorized change"}
              </button>
            )}
            {applyOutcomeUncertain && typeof onReconcileApplyOutcome === "function" && (
              <button
                type="button"
                className="ghost compact"
                data-capability-action="reconcile-apply-outcome"
                onClick={onReconcileApplyOutcome}
              >
                Reconcile exact outcome
              </button>
            )}
            {applyOutcomeRecoverable && typeof onRecoverApply === "function" && (
              <button
                type="button"
                className="cta compact"
                data-capability-action="recover-not-committed-apply"
                onClick={onRecoverApply}
              >
                {applyOutcome.sourceChanged
                  ? "Open authoritative quote"
                  : "Start fresh simulation"}
              </button>
            )}
          </div>

          {applyOutcome && (
            <article
              ref={outcomeReceiptRef}
              tabIndex={-1}
              className="staff-evidence-outcome"
              data-commercial-change-outcome-receipt={applyOutcome.outcomeReceiptId}
            >
              <strong>
                {applyOutcome.state === "committed"
                  ? "Exact apply proven committed"
                  : "Exact apply proven not committed"}
              </strong>
              <p>
                {applyOutcome.state === "committed"
                  ? applyOutcome.appliedRevisionIsActive
                    ? "The immutable applied revision is the active quote source."
                    : "The apply committed, but a later quote revision is now active."
                  : applyOutcome.sourceChanged
                    ? "The request is fenced from late commit and the saved quote source has changed."
                    : "The request is fenced from late commit; a fresh simulation may now begin."}
              </p>
              <code>{applyOutcome.outcomeReceiptId}</code>
            </article>
          )}

          {applyResult && (
            <article className="staff-evidence-outcome" data-commercial-change-apply-receipt={applyResult.applyReceiptId || "dormant"}>
              <strong>{applyResult.state === "BLOCKED" ? "Applied; reconciliation required" : "Apply receipt recorded"}</strong>
              <p>
                {formatWorkspaceInteger(applyResult.openInvalidationCount)} open of {formatWorkspaceInteger(applyResult.totalInvalidationCount)} named invalidations. Safe to publish: {applyResult.safeToPublish === true ? "YES" : "NO"}.
              </p>
              {applyResult.applyReceiptId && <code>{applyResult.applyReceiptId}</code>}
            </article>
          )}
        </>
      )}

      <p className="workflow-attention-boundary" role="note">
        Apply commits the quote version and named dependency invalidations together. It does not regenerate, reconcile, publish, deliver, accept, book, or collect payment.
      </p>
    </section>
  );
}

export default function CommercialChangeImpactPanel({
  model = null,
  loading = false,
  recovering = false,
  error = "",
  partial = false,
  authorityState = "",
  authorizationRequired = false,
  staffRole = "sales",
  approval = null,
  authorizationReceiptId = "",
  mutationState = "ready",
  mutationKind = "",
  mutationMessage = "",
  applyResult = null,
  applyOutcome = null,
  scopeCurrent = false,
  onRetry,
  onReturnToEdit,
  onRequestAuthorization,
  onRefreshAuthorization,
  onAuthorize,
  onApply,
  onReconcileApplyOutcome,
  onRecoverApply,
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
      <CommercialImpactShimmer
        model={model}
        state={view.state}
        snapshotAvailable={view.snapshotAvailable}
      />
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
      {view.snapshotAvailable && (
        <CommercialChangeAuthorityControls
          authorityState={authorityState}
          authorizationRequired={authorizationRequired}
          staffRole={staffRole}
          approval={approval}
          authorizationReceiptId={authorizationReceiptId}
          mutationState={mutationState}
          mutationKind={mutationKind}
          mutationMessage={mutationMessage}
          applyResult={applyResult}
          applyOutcome={applyOutcome}
          scopeCurrent={scopeCurrent && !partial && !error}
          onRequestAuthorization={onRequestAuthorization}
          onRefreshAuthorization={onRefreshAuthorization}
          onAuthorize={onAuthorize}
          onApply={onApply}
          onReconcileApplyOutcome={onReconcileApplyOutcome}
          onRecoverApply={onRecoverApply}
        />
      )}
    </section>
  );
}
