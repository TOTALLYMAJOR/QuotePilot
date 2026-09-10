import "./attendanceWorkflowPresentation.css";
import { lazy, Suspense } from "react";
const WorkflowPackPolicyPanel = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true" ? lazy(() => import("./WorkflowPackPolicyPanel")) : null;
import { useEffect, useRef, useState } from "react";
import StatusChip from "./StatusChip";
import ShimmerReveal from "./ShimmerReveal";
import { COMMERCIAL_CHANGE_IMPACT_BOUNDARY } from "../lib/commercialChangeImpact";
import {
  humanizeTriggerList,
  summarizeExactDiff
} from "./commercialChangeDiffPresentation";
import {
  formatWorkspaceInteger,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";
import UnifiedCommercialConsequenceReview from "./UnifiedCommercialConsequenceReview";

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
    emptyLabel: "Changed detail"
  });
}

function dependencyLabel(nodeId) {
  return humanizeWorkspaceValue(text(nodeId).replace(/^[^.]+\./, ""), {
    emptyLabel: "Dependent decision"
  });
}

const CONSEQUENCE_DOMAINS = Object.freeze([
  { id: "commercial", label: "Commercial & payment", patterns: ["pricing", "payment", "deposit", "balance"] },
  { id: "staffing", label: "Staffing", patterns: ["staff", "labor", "crew"] },
  { id: "production", label: "Production & rentals", patterns: ["production", "kitchen", "food", "rental", "beo"] },
  { id: "operations", label: "Event operations", patterns: ["operations", "delivery_window", "checkpoint", "venue_setup"] },
  { id: "customer", label: "Customer & documents", patterns: ["customer", "contract", "proposal", "decision"] }
]);

export function groupCommercialConsequences(nodes = []) {
  const groups = new Map(CONSEQUENCE_DOMAINS.map((domain) => [domain.id, { ...domain, items: [] }]));
  const other = { id: "other", label: "Related workflow", items: [] };
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const id = text(node?.id || node?.nodeId).toLowerCase();
    const domain = CONSEQUENCE_DOMAINS.find((candidate) => (
      candidate.patterns.some((pattern) => id.includes(pattern))
    ));
    (domain ? groups.get(domain.id) : other).items.push(node);
  });
  return [...groups.values(), other]
    .filter((group) => group.items.length > 0)
    .map(({ patterns: _patterns, ...group }) => group);
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
      <h4 id="commercial-change-impact-money-title">Price change</h4>
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
      <h4 id="commercial-change-impact-facts-title">What changed</h4>
      {factDiffs.length === 0 ? (
        <p className="muted">No tracked input changed in this simulation.</p>
      ) : (
        <div className="commercial-change-facts">
          {factDiffs.map((diff) => {
            const summary = summarizeExactDiff(diff.before, diff.proposedAfter);
            return (
              <article key={diff.nodeId} data-change-fact={diff.nodeId} className="commercial-change-fact">
                <p className="commercial-change-fact-title">
                  <strong>{factLabel(diff.nodeId)}</strong>
                  <span>
                    {summary.total === 0
                      ? "Recorded value updated"
                      : `${summary.total}${summary.truncated ? "+" : ""} field change${summary.total === 1 ? "" : "s"}`}
                  </span>
                </p>
                {summary.rows.length > 0 && (
                  <ul className="commercial-change-fact-rows">
                    {summary.rows.map((row) => (
                      <li key={row.path} data-diff-kind={row.kind}>
                        <span className="commercial-change-fact-label">{row.label}</span>
                        <span className="commercial-change-fact-values">{row.before} → {row.after}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {summary.moreCount > 0 && (
                  <p className="muted">
                    …and {summary.moreCount}{summary.truncated ? "+" : ""} more in the exact data below.
                  </p>
                )}
                <details className="commercial-change-exact">
                  <summary>Exact before and after data</summary>
                  <dl>
                    <div>
                      <dt><code>{diff.nodeId}</code></dt>
                      <dd>
                        <span>Before: <code data-value-side="before">{exactFactValue(diff.before)}</code></span>
                        <span>Proposed: <code data-value-side="proposed-after">{exactFactValue(diff.proposedAfter)}</code></span>
                      </dd>
                    </div>
                  </dl>
                </details>
              </article>
            );
          })}
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
            ? "Nothing becomes out of date under this change."
            : "Nothing needs a human review under this change."}
        </p>
      ) : (
        <ol className="command-center-list">
          {items.map((node) => {
            const triggers = humanizeTriggerList(node.triggeredBy);
            return (
              <li
                className="command-center-row"
                key={node.id || node.nodeId}
                data-dependent-node={node.id || node.nodeId}
              >
                <div className="command-center-row-main">
                  <strong>{dependencyLabel(node.id || node.nodeId)}</strong>
                  <p className="command-center-row-meta">
                    {isStale
                      ? "Marked out of date when the change applies, until it is regenerated."
                      : "Look it over before it goes back to the client."}
                  </p>
                  <p className="command-center-row-meta">
                    {triggers ? `Because this changed: ${triggers}` : "Source unavailable"}
                  </p>
                </div>
                <StatusChip family={isStale ? "pending" : "action"} label={isStale ? "Out of date" : "Review"} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ConsequenceSummary({ model }) {
  const groups = groupCommercialConsequences(model.impact?.dependentNodes);
  return (
    <section className="workflow-form-section" aria-labelledby="commercial-change-consequence-summary-title">
      <p className="eyebrow">Business consequence</p>
      <h4 id="commercial-change-consequence-summary-title">Where this proposal changes the work</h4>
      {groups.length === 0 ? (
        <p className="muted">The server found no related decision or artifact affected by this proposal.</p>
      ) : (
        <div className="commercial-consequence-groups">
          {groups.map((group) => (
            <article key={group.id} data-consequence-domain={group.id}>
              <strong>{group.label}</strong>
              <p>
                {group.items.map((node) => dependencyLabel(node.id || node.nodeId)).join(", ")}
              </p>
              <span>
                {group.items.filter((node) => (node.advisoryClass || node.classification) === "STALE").length} become out of date · {group.items.filter((node) => (node.advisoryClass || node.classification) === "REVIEW").length} need review
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PreservedTruth({ commitment }) {
  const evidence = Array.isArray(commitment?.preservedEvidence)
    ? commitment.preservedEvidence
    : [];
  return (
    <section className="workflow-form-section" aria-labelledby="commercial-change-preserved-title">
      <p className="eyebrow">Preserved truth</p>
      <h4 id="commercial-change-preserved-title">What this amendment will not rewrite</h4>
      {evidence.length === 0 ? (
        <p className="source-note">
          No acceptance, provider-confirmed payment, booking, or provider-delivery evidence is present in the loaded quote. Missing evidence is not treated as success.
        </p>
      ) : (
        <ul className="commercial-preserved-truth">
          {evidence.map((item) => (
            <li key={`${item.kind}:${item.recordedAtISO}:${item.revisionId}`}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              {(item.recordedAtISO || item.revisionId) && (
                <small>{item.recordedAtISO || "Time unavailable"}{item.revisionId ? ` · revision ${item.revisionId}` : ""}</small>
              )}
            </li>
          ))}
        </ul>
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
      <CommercialDelta model={model} />
      <FactDiffs factDiffs={factDiffs} />
      <ConsequenceSummary model={model} />

      <section className="workflow-form-section" aria-labelledby="commercial-change-impact-dependents-title">
        <h4 id="commercial-change-impact-dependents-title">What this touches after apply</h4>
        <p className="staff-evidence-bounds-note">
          {formatWorkspaceInteger(model.impact?.counts?.review)} to review · {formatWorkspaceInteger(model.impact?.counts?.stale)} out of date · {formatWorkspaceInteger(model.impact?.counts?.total)} related items
        </p>
        <div className="workflow-form-grid">
          <DependencyList
            title="Review before sending"
            titleId="commercial-change-impact-review-title"
            advisoryClass="REVIEW"
            items={reviewItems}
          />
          <DependencyList
            title="Becomes out of date"
            titleId="commercial-change-impact-stale-title"
            advisoryClass="STALE"
            items={staleItems}
          />
        </div>
      </section>

      <details className="commercial-change-evidence">
        <summary>Simulation evidence</summary>
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
            <dd>{formatWorkspaceInteger(factDiffs.length)} of {formatWorkspaceInteger(bounds.changedFactLimit)} changed inputs<small>{formatWorkspaceInteger(dependents.length)} of {formatWorkspaceInteger(bounds.dependentNodeLimit)} dependents · {formatWorkspaceInteger(bounds.declaredFactCount)} tracked inputs · {formatWorkspaceInteger(bounds.outputByteLimit)} byte output limit</small></dd>
          </div>
        </dl>
      </details>
    </>
  );
}

function formatIngredientQuantity(micros, unit, { signed = false } = {}) {
  if (!Number.isSafeInteger(micros)) return "Unknown";
  const absolute = Math.abs(micros);
  const whole = Math.floor(absolute / 1_000_000);
  const fraction = String(absolute % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  const quantity = fraction ? `${whole}.${fraction}` : String(whole);
  const sign = signed && micros > 0 ? "+" : signed && micros < 0 ? "−" : "";
  return `${sign}${quantity} ${unit}`;
}

function inventoryEvidenceStateLabel(state) {
  return ({
    current: "Current evidence",
    not_evaluated: "Not evaluated",
    pending: "Preview pending",
    stale: "Evidence changed",
    mismatched: "Evidence mismatch",
    unavailable: "Unavailable"
  })[state] || "Unavailable";
}

function IngredientConsequenceIntelligence({ consequence }) {
  if (!consequence) return null;
  const current = consequence.state === "current";
  const cost = consequence.cost || {};
  const availability = consequence.availability || {};
  const rows = Array.isArray(availability.ingredients) ? availability.ingredients : [];
  const changedRows = rows.filter((row) => row.changed);
  const stateFamily = current ? "confirmed"
    : consequence.state === "pending" ? "pending"
      : consequence.state === "not_evaluated" ? "info" : "action";
  return (
    <section
      className="workflow-form-section"
      aria-labelledby="commercial-change-ingredient-intelligence-title"
      data-commercial-inventory-consequence={consequence.state}
      data-authority="read-only-advisory"
    >
      <div className="workflow-attention-head">
        <div>
          <p className="eyebrow">Ingredient consequence · read only</p>
          <h4 id="commercial-change-ingredient-intelligence-title">Food cost and stock impact</h4>
        </div>
        <StatusChip family={stateFamily} label={inventoryEvidenceStateLabel(consequence.state)} />
      </div>
      {!current ? (
        <p className="source-note" role={consequence.state === "unavailable" ? "alert" : "status"}>
          Ingredient consequence evidence is {inventoryEvidenceStateLabel(consequence.state).toLowerCase()}.
          Run a server preview for this exact unsaved scenario; cached, pending, stale, or mismatched evidence is never shown as current.
        </p>
      ) : (
        <>
          <div className="workflow-form-grid" data-inventory-rails="independent">
            <article data-inventory-rail="cost">
              <h5>Projected ingredient cost</h5>
              {["changed", "unchanged"].includes(cost.state) ? (
                <>
                  <p>
                    {formatCurrency(cost.before.projectedCostMinor / 100, cost.currency)} →{" "}
                    {formatCurrency(cost.proposedAfter.projectedCostMinor / 100, cost.currency)}
                  </p>
                  <strong>{formatSignedCurrency(
                    cost.before.projectedCostMinor / 100,
                    cost.proposedAfter.projectedCostMinor / 100,
                    cost.currency
                  )}</strong>
                </>
              ) : (
                <p className="warning-note">
                  Cost change is unknown. Both estimates must be complete and use the same currency; unknown cost is not treated as zero.
                </p>
              )}
            </article>
            <article data-inventory-rail="availability">
              <h5>Ingredient stock availability</h5>
              {["changed", "unchanged"].includes(availability.state) ? (
                <p>
                  {changedRows.length === 0
                    ? "No ingredient requirement or shortage change."
                    : `${changedRows.length} ingredient requirement${changedRows.length === 1 ? "" : "s"} changed.`}
                </p>
              ) : (
                <p className="warning-note">Availability comparison is incomplete. Known cost evidence remains independent.</p>
              )}
            </article>
          </div>
          {changedRows.length > 0 && (
            <ul className="command-center-list" aria-label="Ingredient requirement and shortage changes">
              {changedRows.map((row) => (
                <li className="command-center-row" key={`${row.ingredientId}:${row.baseUnitId}`}>
                  <div className="command-center-row-main">
                    <strong>{row.proposedAfter?.ingredientName || row.before?.ingredientName || row.ingredientId}</strong>
                    <p className="command-center-row-meta">
                      Requirement {formatIngredientQuantity(row.requiredDeltaMicros, row.baseUnitId, { signed: true })}
                      {Number.isSafeInteger(row.shortageDeltaMicros)
                        ? ` · Shortage ${formatIngredientQuantity(row.shortageDeltaMicros, row.baseUnitId, { signed: true })}`
                        : " · Shortage comparison unavailable"}
                    </p>
                  </div>
                  <StatusChip
                    family={row.proposedAfter?.availabilityState === "shortage" ? "action" : "info"}
                    label={row.proposedAfter?.availabilityState === "shortage" ? "Shortage" : "Review"}
                  />
                </li>
              ))}
            </ul>
          )}
          <details className="commercial-change-evidence">
            <summary>Ingredient consequence provenance</summary>
            <dl className="staff-evidence-details">
              <div><dt>Saved requirement</dt><dd><code>{consequence.provenance.before.eventRequirementRevisionId}</code><small>revision {consequence.provenance.before.requirementRevision} · digest <code>{consequence.provenance.before.requirementDigest}</code></small></dd></div>
              <div><dt>Scenario requirement</dt><dd><code>{consequence.provenance.proposedAfter.eventRequirementRevisionId}</code><small>digest <code>{consequence.provenance.proposedAfter.requirementDigest}</code></small></dd></div>
              <div><dt>Quote source</dt><dd><code>{consequence.expected.quoteId}</code><small>revision <code>{consequence.expected.savedQuoteRevisionId}</code></small></dd></div>
              <div><dt>Scenario fingerprint</dt><dd><code>{consequence.provenance.proposedAfter.projectionDigest}</code><small>Server preview matched the exact unsaved form fingerprint; form contents are not exposed here.</small></dd></div>
              <div><dt>Saved projection</dt><dd><code>{consequence.provenance.before.projectionDigest}</code><small>Source fingerprint <code>{consequence.provenance.before.sourceFingerprint}</code></small></dd></div>
              <div><dt>Scenario projection</dt><dd><code>{consequence.provenance.proposedAfter.projectionDigest}</code><small>Source fingerprint <code>{consequence.provenance.proposedAfter.sourceFingerprint}</code></small></dd></div>
            </dl>
          </details>
        </>
      )}
      <p className="workflow-attention-boundary" role="note">
        This is consequence intelligence only. It does not reserve ingredients, change selling prices, authorize this amendment, or alter commercial apply and publish controls.
      </p>
    </section>
  );
}

function AmendmentReceipt({
  model,
  commitment,
  authorityState,
  applyResult,
  applyOutcome,
  appliedQuote,
  onOpenAppliedQuote
}) {
  const receiptRef = useRef(null);
  const focusedReceiptRef = useRef("");
  const receiptIdentity = text(
    applyResult?.applyReceiptId
    || applyOutcome?.outcomeReceiptId
    || appliedQuote?.activeVersionId
  );
  const committed = Boolean(appliedQuote)
    || Boolean(applyResult)
    || applyOutcome?.state === "committed";
  const dependents = Array.isArray(model?.impact?.dependentNodes)
    ? model.impact.dependentNodes
    : [];

  useEffect(() => {
    if (!committed || !receiptIdentity || focusedReceiptRef.current === receiptIdentity) return;
    focusedReceiptRef.current = receiptIdentity;
    receiptRef.current?.focus({ preventScroll: true });
  }, [committed, receiptIdentity]);

  if (!committed) return null;
  const enforced = text(authorityState).toLowerCase() === "enforced";
  const changedCount = Array.isArray(model?.factDiffs) ? model.factDiffs.length : 0;
  const newRevisionId = text(appliedQuote?.activeVersionId || applyOutcome?.newRevisionId);

  return (
    <article
      ref={receiptRef}
      tabIndex={-1}
      className="commercial-amendment-receipt"
      data-capability-id="qp-uxr-001-amendment-receipt"
      data-capability-state="receipt"
      data-commercial-change-apply-receipt={applyResult?.applyReceiptId || "dormant"}
      aria-labelledby="commercial-amendment-receipt-title"
    >
      <header>
        <div>
          <p className="eyebrow">Governed outcome</p>
          <h4 id="commercial-amendment-receipt-title">Amendment receipt</h4>
        </div>
        <StatusChip family="confirmed" label="New revision recorded" />
      </header>
      <div className="commercial-amendment-receipt-grid">
        <section>
          <h5>Changed</h5>
          <p>{changedCount} tracked input{changedCount === 1 ? "" : "s"} committed to {newRevisionId ? `revision ${newRevisionId}` : "a new quote revision"}.</p>
          <p>
            Total {model?.commercialValues?.authoritativeTotal?.changed === true ? "changed" : "unchanged"}; deposit requirement {model?.commercialValues?.depositRequirement?.changed === true ? "changed" : "unchanged"}.
          </p>
        </section>
        <section>
          <h5>Preserved</h5>
          {commitment?.preservedEvidence?.length ? (
            <ul>{commitment.preservedEvidence.map((item) => <li key={item.kind}>{item.label}</li>)}</ul>
          ) : (
            <p>No protected acceptance, payment, booking, or provider-delivery evidence was present in the loaded source.</p>
          )}
        </section>
        <section>
          <h5>Needs attention</h5>
          {enforced ? (
            dependents.length > 0
              ? <ul>{dependents.map((node) => <li key={node.id || node.nodeId}>{dependencyLabel(node.id || node.nodeId)}</li>)}</ul>
              : <p>No named dependent item requires review or regeneration.</p>
          ) : (
            <p>Enforcement was dormant, so this is review evidence only: no dependency invalidation was persisted or implied.</p>
          )}
        </section>
        <section>
          <h5>Next</h5>
          <p>{commitment?.protocol?.nextAction || "Review the new quote revision before continuing."}</p>
          {typeof onOpenAppliedQuote === "function" && (
            <button type="button" className="cta compact" onClick={onOpenAppliedQuote}>
              Review updated quote
            </button>
          )}
        </section>
      </div>
      <details>
        <summary>Exact receipt evidence</summary>
        <p>
          Apply receipt: <code>{formatWorkspaceText(applyResult?.applyReceiptId, { emptyLabel: "Dormant review — no apply receipt issued" })}</code>
        </p>
        {applyOutcome?.outcomeReceiptId && <p>Outcome receipt: <code>{applyOutcome.outcomeReceiptId}</code></p>}
      </details>
    </article>
  );
}

function CommercialChangeAuthorityControls({
  model = null,
  commitment = null,
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
  appliedQuote = null,
  scopeCurrent = false,
  onRequestAuthorization,
  onRefreshAuthorization,
  onAuthorize,
  onApply,
  onReconcileApplyOutcome,
  onRecoverApply,
  onOpenAppliedQuote
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
  const policyRoleAllowed = !model?.workflowPolicy || model.workflowPolicy.approvalPolicy.allowedRoles.includes(staffRole);
  const attendanceApply = Boolean(model?.attendanceBinding);
  const requiresAuthorization = normalizedAuthority === "enforced" && authorizationRequired;
  const canMutate = scopeCurrent && !busy && policyRoleAllowed;
  const canApply = canMutate && (!requiresAuthorization || authorized);

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
          <p className="eyebrow">Approval &amp; apply</p>
          <h4 id="commercial-change-authority-title">Apply this exact change</h4>
        </div>
        <StatusChip {...mutationPresentation} />
      </div>

      <p className={scopeCurrent ? "source-note" : "warning-note"} role={scopeCurrent ? "status" : "alert"}>
        {scopeCurrent
          ? requiresAuthorization
            ? "The simulation still matches the unsaved form and saved base revision. Authorization is scoped to this exact evidence."
            : "The simulation still matches the unsaved form and saved base revision. It can continue without an administrator authorization receipt."
          : "The unsaved form or saved revision changed after simulation. Authorization and apply are disabled until you re-simulate."}
      </p>

      {normalizedAuthority !== "enforced" && (
        <p className="source-note" role="status">
          Commercial-change enforcement is dormant for this workspace. The reviewed simulation will travel with the save, but no dependency invalidation or production authority is created.
        </p>
      )}
      {normalizedAuthority === "enforced" && !authorizationRequired && (
        <p className="source-note" role="status">
          The server found no governed dependency impact. No administrator authorization receipt is required; the reviewed change can be applied through this exact simulation.
        </p>
      )}

      {!policyRoleAllowed && <p className="warning-note" role="alert">The published quote review policy excludes your role from this change.</p>}
      {attendanceApply && !authorizationRequired && <p className="source-note">No administrator approval is required for this preview. Apply explicitly to record the submitted count against a new quote version.</p>}

      {requiresAuthorization && (
        <>
          <dl className="staff-evidence-details">
            <div>
              <dt>Approval state</dt>
              <dd>{!authorizationRequired ? "Not required" : humanizeWorkspaceValue(approvalState, { emptyLabel: "Not requested" })}<small>{approval?.approvalRequestId ? <code>{approval.approvalRequestId}</code> : "No approval request receipt"}</small></dd>
            </div>
            <div>
              <dt>Authorization receipt</dt>
              <dd>{authorizationReceiptId ? "Exact receipt ready" : !authorizationRequired ? "Not required" : "Not authorized"}<small>{authorizationReceiptId ? <code>{authorizationReceiptId}</code> : "No authorization may be inferred"}</small></dd>
            </div>
          </dl>

          <div className="right-actions commercial-change-authorization-actions">
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
            {authorizationRequired && !authorized && !isAdmin && !approvalState && typeof onRequestAuthorization === "function" && (
              <button
                type="button"
                className="cta compact"
                onClick={onRequestAuthorization}
                disabled={!canMutate}
              >
                Request admin authorization
              </button>
            )}
            {authorizationRequired && !authorized && approvalState === "pending" && typeof onRefreshAuthorization === "function" && (
              <button
                type="button"
                className="ghost compact"
                onClick={onRefreshAuthorization}
                disabled={!canMutate}
              >
                Refresh approval state
              </button>
            )}
          </div>
        </>
      )}

      {mutationMessage && (
        <p
          className={["uncertain", "error"].includes(normalizedMutation) ? "warning-note" : "source-note"}
          role={["uncertain", "error"].includes(normalizedMutation) ? "alert" : "status"}
        >
          {mutationMessage}
        </p>
      )}

      <div className="right-actions commercial-change-apply-actions">
        {typeof onApply === "function" && !applyOutcomeRecoverable && (
          <button
            type="button"
            className="cta compact"
            onClick={onApply}
            disabled={!canApply || applyOutcomeUncertain || Boolean(applyResult) || applyOutcome?.state === "committed"}
            title={applyOutcomeUncertain
              ? "The prior outcome is unresolved. Reconcile this exact request; this screen will not submit the edit again."
              : !scopeCurrent
                ? "Re-simulate before applying."
                : requiresAuthorization && !authorized
                  ? "Obtain administrator authorization for this exact simulation before applying."
                  : "Apply this reviewed edit through the existing trusted quote authority."}
          >
            {normalizedMutation === "applying"
              ? "Applying reviewed change…"
              : applyOutcomeUncertain
                ? "Apply outcome unresolved"
                : applyResult || applyOutcome?.state === "committed"
                  ? "Reviewed change applied"
                  : requiresAuthorization
                    ? "Apply authorized change"
                    : attendanceApply
                      ? "Apply reviewed guest count"
                      : "Apply reviewed change"}
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
          className="staff-evidence-outcome commercial-change-outcome-proof"
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

      <AmendmentReceipt
        model={model}
        commitment={commitment}
        authorityState={normalizedAuthority}
        applyResult={applyResult}
        applyOutcome={applyOutcome}
        appliedQuote={appliedQuote}
        onOpenAppliedQuote={onOpenAppliedQuote}
      />

      <p className="workflow-attention-boundary" role="note">
        Apply commits the quote version and named dependency invalidations together. It does not regenerate, reconcile, publish, deliver, accept, book, or collect payment.
      </p>
    </section>
  );
}

function BoundCommercialReview({ model }) {
  if (!model?.approvalEvaluation) return null;
  const policy = model.workflowPolicy;
  const evaluation = model.approvalEvaluation;
  const usd = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const threshold = policy?.approvalPolicy.thresholdCents ?? null;
  return <section className="workflow-form-section" aria-label="Published approval and guest count evidence">
    <h4>{model.attendanceBinding ? "Before you apply this guest count" : "Approval for this change"}</h4>
    <p><strong>{usd(evaluation.absoluteTotalDeltaCents)} total price change</strong> · {evaluation.impactApprovalRequired || evaluation.thresholdApprovalRequired ? "Administrator approval required" : "No administrator approval required"}</p>
    <details><summary>Approval policy and threshold</summary><dl className="staff-evidence-details">
      <div><dt>Quote review policy</dt><dd>{policy ? `Published version ${policy.definitionPin.version}` : "Existing commercial approval rules"}</dd></div>
      <div><dt>Absolute total change</dt><dd>{usd(evaluation.absoluteTotalDeltaCents)}</dd></div>
      <div><dt>Declared approval threshold</dt><dd>{threshold === null ? "No additional threshold declared" : `${usd(threshold)} or more`}</dd></div>
      {policy && <div><dt>Permitted participants</dt><dd>{policy.approvalPolicy.allowedRoles.map(role => role === "admin" ? "Administrator" : "Sales").join(", ")}</dd></div>}
    </dl></details>
    <p>{evaluation.impactApprovalRequired ? "Administrator approval is required because governed dependencies are affected." : "No governed dependency requires administrator approval."}</p>
    <p>{evaluation.thresholdApprovalRequired ? "Administrator approval is required because the total change meets or exceeds the published threshold." : "The published threshold adds no approval requirement to this preview."}</p>
    {model.attendanceBinding && <div className="attendance-commercial-review"><p><strong>Submitted guest count: {model.attendanceBinding.count}.</strong> This exact response remains proposed until you apply the reviewed change, even if the number matches the quote.</p><ul className="attendance-commercial-review__changes"><li>Applying creates a new draft quote revision and clears current acceptance.</li><li>Send the revised quote for separate customer acceptance, then revalidate the booking as an administrator.</li><li>Prior acceptance, payment and booking history remain preserved; no payment is charged.</li></ul></div>}
  </section>;
}

export default function CommercialChangeImpactPanel({
  workflowEnabled = false,
  principalId = "",
  model = null,
  commitment = null,
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
  appliedQuote = null,
  scopeCurrent = false,
  inventoryConsequences = null,
  onRetry,
  onReturnToEdit,
  onRequestAuthorization,
  onRefreshAuthorization,
  onAuthorize,
  onApply,
  onReconcileApplyOutcome,
  onRecoverApply,
  unifiedReview = null,
  onApplyAllConsequences,
  onApplySelectedConsequences,
  onKeepQuotedPlan,
  onOpenAppliedQuote,
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
          <p className="eyebrow">Before you save · preview only</p>
          <h3 id={titleId}>What this change affects</h3>
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
      {inventoryConsequences && <IngredientConsequenceIntelligence consequence={inventoryConsequences} />}
      {view.snapshotAvailable && <PreservedTruth commitment={commitment} />}
      {view.snapshotAvailable && unifiedReview && (
        <UnifiedCommercialConsequenceReview
          review={unifiedReview}
          scopeCurrent={scopeCurrent && !partial && !error}
          busy={loading || recovering || ["submitting", "applying", "reconciliation"].includes(text(mutationState).toLowerCase())}
          onApplyAll={onApplyAllConsequences}
          onApplySelected={onApplySelectedConsequences}
          onKeepQuotedPlan={onKeepQuotedPlan}
        />
      )}
      {view.snapshotAvailable && <BoundCommercialReview model={model} />}
      {WorkflowPackPolicyPanel && workflowEnabled && view.snapshotAvailable && model?.receiptId && <Suspense fallback={<p role="status">Loading quote review coordination...</p>}><WorkflowPackPolicyPanel organizationId={model.identity.organizationId} quoteId={model.identity.quoteId} principalId={principalId} role={staffRole} enabled={workflowEnabled} workflowKind="quote_review" simulationReceiptId={model.receiptId} sourceVersionId={model.identity.beforeRevisionId} sourceReceiptId={model.receiptId} domainRevision={authorizationReceiptId || model.receiptId} otherMutationBlocked={["submitting", "reconciliation", "applying", "uncertain", "error", "recovery"].includes(mutationState)} /></Suspense>}
      {view.snapshotAvailable && (
        <CommercialChangeAuthorityControls
          model={model}
          commitment={commitment}
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
          appliedQuote={appliedQuote}
          scopeCurrent={scopeCurrent && !partial && !error}
          onRequestAuthorization={onRequestAuthorization}
          onRefreshAuthorization={onRefreshAuthorization}
          onAuthorize={onAuthorize}
          onApply={onApply}
          onReconcileApplyOutcome={onReconcileApplyOutcome}
          onRecoverApply={onRecoverApply}
          onOpenAppliedQuote={onOpenAppliedQuote}
        />
      )}
    </section>
  );
}
