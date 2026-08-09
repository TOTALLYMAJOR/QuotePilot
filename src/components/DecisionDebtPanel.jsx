import { useEffect, useMemo, useState } from "react";
import StatusChip from "./StatusChip";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";

const READ_PRESENTATION = Object.freeze({
  loading: Object.freeze({ family: "pending", label: "Loading decision debt" }),
  empty: Object.freeze({ family: "info", label: "No current debt" }),
  success: Object.freeze({ family: "confirmed", label: "Snapshot current" }),
  stale: Object.freeze({ family: "action", label: "Retained snapshot" }),
  partial: Object.freeze({ family: "action", label: "Bounded snapshot" }),
  error: Object.freeze({ family: "failed", label: "Snapshot unavailable" })
});

const READ_COPY = Object.freeze({
  loading: "Reading the current tenant-scoped decision snapshot. No task, payment, booking, or customer record is changed.",
  empty: "No unresolved Decision Debt appears in this bounded server snapshot.",
  success: "The server-derived snapshot is current for its recorded tenant-calendar observation.",
  stale: "The latest read did not complete. The retained snapshot remains visible but may no longer reflect current decisions.",
  partial: "This snapshot reached a declared bound. Missing decisions remain unknown and must not be treated as resolved.",
  error: "Decision Debt could not be read and no retained server snapshot is available."
});

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({ family: "info", label: "Policy ready" }),
  submitting: Object.freeze({ family: "pending", label: "Saving policy" }),
  uncertain: Object.freeze({ family: "action", label: "Outcome uncertain" }),
  reconciliation: Object.freeze({ family: "pending", label: "Reconciling policy" }),
  receipt: Object.freeze({ family: "confirmed", label: "Policy receipt" }),
  error: Object.freeze({ family: "failed", label: "Policy rejected" }),
  recovery: Object.freeze({ family: "action", label: "Recovery available" })
});

const MUTATION_COPY = Object.freeze({
  ready: "No Decision Debt policy change is currently in flight.",
  submitting: "The exact policy request is in flight. Do not submit another policy change.",
  uncertain: "The outcome is unknown. Reconcile the unchanged request before making another policy change.",
  reconciliation: "QuotePilot is checking the same request identity; this does not create a second policy change.",
  receipt: "The server recorded the exact policy request. This receipt does not resolve any underlying decision.",
  error: "The server definitively rejected the policy request. No successful policy change is assumed.",
  recovery: "The rejected attempt can be safely reset before an administrator prepares a corrected policy."
});

const URGENCY_PRESENTATION = Object.freeze({
  unknown: Object.freeze({ family: "action", label: "Priority unknown" }),
  low: Object.freeze({ family: "info", label: "Low urgency" }),
  medium: Object.freeze({ family: "pending", label: "Medium urgency" }),
  high: Object.freeze({ family: "action", label: "High urgency" }),
  critical: Object.freeze({ family: "failed", label: "Critical urgency" })
});

const MUTATION_STATES = new Set(Object.keys(MUTATION_PRESENTATION));

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapSnapshot(value) {
  return isRecord(value?.snapshot) ? value.snapshot : value;
}

function snapshotIsSafe(value) {
  const snapshot = unwrapSnapshot(value);
  return isRecord(snapshot)
    && snapshot.schemaVersion === "decision-debt-snapshot-v1"
    && snapshot.formulaVersion === "decision-debt-score-v1"
    && snapshot.authority === "server_derived"
    && snapshot.predictive === false
    && Array.isArray(snapshot.items)
    && isRecord(snapshot.bounds)
    && isRecord(snapshot.policy)
    && isRecord(snapshot.graph);
}

function snapshotIsPartial(snapshot) {
  const returnedCount = Number(snapshot?.bounds?.returnedCount);
  const eligibleCount = Number(snapshot?.bounds?.eligibleCount);
  return snapshot?.bounds?.truncated === true
    || !Number.isSafeInteger(returnedCount)
    || !Number.isSafeInteger(eligibleCount)
    || returnedCount !== snapshot.items.length
    || eligibleCount > returnedCount;
}

function normalizeMutation(mutation) {
  const candidate = isRecord(mutation) ? mutation : {};
  const requested = text(candidate.state).toLowerCase() || "ready";
  const state = MUTATION_STATES.has(requested) ? requested : "error";
  return {
    ...candidate,
    state,
    presentation: MUTATION_PRESENTATION[state],
    detail: MUTATION_COPY[state],
    busy: new Set(["submitting", "reconciliation"]).has(state)
  };
}

export function buildDecisionDebtPresentation({
  snapshot = null,
  loading = false,
  error = "",
  stale = false,
  partial = false,
  mutation = null
} = {}) {
  const supplied = isRecord(snapshot);
  const safe = snapshotIsSafe(snapshot);
  const canonicalSnapshot = safe ? unwrapSnapshot(snapshot) : null;
  let state = "success";

  if (loading && !safe) state = "loading";
  else if (!safe && (supplied || text(error))) state = "error";
  else if (!safe) state = "empty";
  else if (stale || text(error) || loading) state = "stale";
  else if (partial || snapshotIsPartial(canonicalSnapshot)) state = "partial";
  else if (canonicalSnapshot.items.length === 0) state = "empty";

  const policyVersion = text(snapshot?.policyVersion || canonicalSnapshot?.policyVersion);
  return {
    state,
    presentation: READ_PRESENTATION[state],
    detail: READ_COPY[state],
    snapshotAvailable: safe,
    retained: safe && state === "stale",
    snapshot: canonicalSnapshot,
    policyVersion,
    mutation: normalizeMutation(mutation)
  };
}

function formatFactorSource(value) {
  return humanizeWorkspaceValue(value, { emptyLabel: "Source not recorded" });
}

function formatDaysUntilLock(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return "Lock timing unavailable";
  if (days < 0) return `${formatWorkspaceInteger(Math.abs(days))} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `${formatWorkspaceInteger(days)} day${days === 1 ? "" : "s"} until lock`;
}

function factorDetail(factorId, factor) {
  if (!isRecord(factor)) return "Evidence unavailable";
  if (factorId === "dependency") {
    return `${formatWorkspaceInteger(factor.affectedDependencyCount)} affected dependencies`;
  }
  if (factorId === "proximity") {
    return `${formatWorkspaceInteger(factor.lockWindowDays)}-day lock · ${formatDaysUntilLock(factor.daysUntilLock)}`;
  }
  if (factorId === "exposure") {
    return factor.known === true && Number.isFinite(factor.cents)
      ? `${formatWorkspaceMoney(Number(factor.cents) / 100)} recorded exposure`
      : "Commercial exposure unavailable—not zero";
  }
  if (factorId === "reversibility") {
    return humanizeWorkspaceValue(factor.classification, { emptyLabel: "Classification unavailable" });
  }
  return "Evidence unavailable";
}

function FactorCard({ factorId, label, factor }) {
  const factorValue = Number.isFinite(factor?.value)
    ? `${formatWorkspaceInteger(factor.value)}×`
    : "Unavailable";
  return (
    <article className="commercial-measure-card" data-decision-debt-factor={factorId}>
      <span>{label}</span>
      <strong>{factorValue}</strong>
      <small>{factorDetail(factorId, factor)}</small>
      <small className="source-note">{formatFactorSource(factor?.source)}</small>
    </article>
  );
}

function AffectedDependencies({ item }) {
  const affected = Array.isArray(item?.affectedNodeIds) ? item.affectedNodeIds : [];
  return (
    <details className="workflow-form-section" data-dependency-count={affected.length}>
      <summary>
        {formatWorkspaceInteger(affected.length)} affected dependenc{affected.length === 1 ? "y" : "ies"}
      </summary>
      {affected.length > 0 ? (
        <ul aria-label={`${text(item?.label) || "Decision"} affected dependencies`}>
          {affected.map((nodeId) => (
            <li key={nodeId} data-dependency-node={nodeId}>
              {humanizeWorkspaceValue(nodeId, { emptyLabel: "Unidentified dependency" })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No dependency nodes were returned; treat this item as incomplete.</p>
      )}
    </details>
  );
}

function DecisionDebtItem({ item, onOpenQuote }) {
  const scoreKnown = text(item?.scoreState).toUpperCase() === "KNOWN";
  const urgency = scoreKnown ? text(item?.urgency).toLowerCase() : "unknown";
  const urgencyPresentation = URGENCY_PRESENTATION[urgency]
    || { family: "failed", label: "Urgency unverified" };
  const factors = isRecord(item?.factors) ? item.factors : {};
  const explanation = Array.isArray(item?.explanation) ? item.explanation.filter(Boolean) : [];
  return (
    <article
      className="customer-revenue-opportunity"
      tabIndex={-1}
      data-decision-debt-id={text(item?.id) || "unidentified"}
      data-decision-debt-urgency={urgency || "unverified"}
    >
      <div className="workspace-route-head">
        <div>
          <span className="customer-revenue-opportunity-type">Unresolved commercial decision</span>
          <h3>{text(item?.label) || "Unnamed decision"}</h3>
          <p>
            Event {formatWorkspaceDate(item?.eventDate)} · lock {formatWorkspaceDate(item?.lockDate)} · {formatDaysUntilLock(item?.daysUntilLock)}
          </p>
        </div>
        <StatusChip {...urgencyPresentation} />
      </div>

      <div className="customer-revenue-metrics" aria-label={`${text(item?.label) || "Decision"} deterministic score`}>
        <article className="commercial-measure-card" data-decision-debt-score={item?.score}>
          <span>Decision Debt score</span>
          <strong>{scoreKnown ? `${formatWorkspaceInteger(item?.score)} / 100` : "Unavailable"}</strong>
          <small>
            {scoreKnown
              ? "Deterministic priority, not a prediction"
              : "Authoritative commercial exposure is required before scoring"}
          </small>
        </article>
        <article className="commercial-measure-card">
          <span>Commercial exposure</span>
          <strong>
            {Number.isFinite(item?.commercialExposureCents)
              ? formatWorkspaceMoney(Number(item.commercialExposureCents) / 100)
              : "Unavailable"}
          </strong>
          <small>Not accounting revenue or a receivable</small>
        </article>
      </div>

      <div className="customer-revenue-metrics" aria-label="Deterministic Decision Debt factors">
        <FactorCard factorId="dependency" label="Dependency weight" factor={factors.dependency} />
        <FactorCard factorId="proximity" label="Proximity" factor={factors.proximity} />
        <FactorCard factorId="exposure" label="Exposure" factor={factors.exposure} />
        <FactorCard factorId="reversibility" label="Reversibility" factor={factors.reversibility} />
      </div>

      <p className="source-note" data-decision-debt-formula>
        {scoreKnown
          ? `${formatWorkspaceInteger(factors.dependency?.value)} × ${formatWorkspaceInteger(factors.proximity?.value)} × ${formatWorkspaceInteger(factors.exposure?.value)} × ${formatWorkspaceInteger(factors.reversibility?.value)} = raw ${formatWorkspaceInteger(item?.rawScore)} → normalized ${formatWorkspaceInteger(item?.score)}/100`
          : "Priority remains unknown: no exposure factor, raw score, normalized score, or urgency has been guessed."}
      </p>

      <AffectedDependencies item={item} />

      {explanation.length > 0 && (
        <ul aria-label={`${text(item?.label) || "Decision"} score explanation`}>
          {explanation.map((line, index) => <li key={`${text(item?.id)}-explanation-${index}`}>{line}</li>)}
        </ul>
      )}

      <div className="workspace-inline-actions">
        <span className="source-note">
          Source revision {text(item?.sourceRevisionId) || "not recorded"}
        </span>
        {typeof onOpenQuote === "function" && text(item?.quoteId) && (
          <button
            type="button"
            className="ghost compact"
            data-capability-action="open-decision-debt-quote"
            onClick={() => onOpenQuote(item.quoteId, item)}
          >
            Open quote record
          </button>
        )}
      </div>
    </article>
  );
}

function PolicySummary({ policy }) {
  const decisionTypes = isRecord(policy?.decisionTypes)
    ? Object.entries(policy.decisionTypes).sort(([left], [right]) => left.localeCompare(right))
    : [];
  return (
    <details className="workflow-form-section" data-decision-debt-policy>
      <summary>Decision lock policy</summary>
      <p className="source-note">
        Event horizon: {formatWorkspaceInteger(policy?.maxEventHorizonDays)} days · schema {formatWorkspaceInteger(policy?.schemaVersion)}
      </p>
      <ul aria-label="Configured decision lock windows">
        {decisionTypes.map(([typeId, definition]) => (
          <li key={typeId} data-decision-type={typeId}>
            <strong>{text(definition?.label) || humanizeWorkspaceValue(typeId)}</strong>: {formatWorkspaceInteger(definition?.lockWindowDays)}-day lock · weight {formatWorkspaceInteger(definition?.dependencyWeight)} · {humanizeWorkspaceValue(definition?.reversibility)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PolicyMutation({
  view,
  isAdmin,
  onConfigurePolicy,
  onReconcilePolicy,
  onResetMutation
}) {
  const mutation = view.mutation;
  const sourcePolicy = view.snapshot?.policy;
  const policyIdentity = `${view.policyVersion}:${JSON.stringify(sourcePolicy || {})}`;
  const buildDraft = () => sourcePolicy
    ? JSON.parse(JSON.stringify(sourcePolicy))
    : null;
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(buildDraft);
  useEffect(() => {
    setDraft(buildDraft());
    setEditorOpen(false);
  // The serialized server policy is the immutable reset boundary for this small editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyIdentity]);
  const decisionTypes = useMemo(
    () => (isRecord(draft?.decisionTypes)
      ? Object.entries(draft.decisionTypes).sort(([left], [right]) => left.localeCompare(right))
      : []),
    [draft]
  );
  const draftValid = Boolean(
    isRecord(draft)
    && Number.isSafeInteger(Number(draft.maxEventHorizonDays))
    && Number(draft.maxEventHorizonDays) >= 1
    && Number(draft.maxEventHorizonDays) <= 730
    && decisionTypes.length > 0
    && decisionTypes.every(([, definition]) => (
      Number.isSafeInteger(Number(definition?.lockWindowDays))
      && Number(definition.lockWindowDays) >= 0
      && Number(definition.lockWindowDays) <= 365
      && Number.isSafeInteger(Number(definition?.dependencyWeight))
      && Number(definition.dependencyWeight) >= 1
      && Number(definition.dependencyWeight) <= 5
      && ["reversible", "constrained", "irreversible"].includes(
        text(definition?.reversibility).toLowerCase()
      )
    ))
  );
  const canConfigure = isAdmin === true
    && view.snapshotAvailable
    && new Set(["success", "partial", "empty"]).has(view.state)
    && !mutation.busy
    && !new Set(["uncertain", "error"]).has(mutation.state)
    && typeof onConfigurePolicy === "function";
  const updateDraftType = (typeId, field, value) => {
    setDraft((current) => ({
      ...current,
      decisionTypes: {
        ...current.decisionTypes,
        [typeId]: {
          ...current.decisionTypes[typeId],
          [field]: ["lockWindowDays", "dependencyWeight"].includes(field)
            ? Number(value)
            : value
        }
      }
    }));
  };
  const submitDraft = (event) => {
    event.preventDefault();
    if (!canConfigure || !draftValid) return;
    onConfigurePolicy({
      policy: draft,
      expectedPolicyVersion: view.policyVersion
    });
  };
  return (
    <section
      className="workflow-form-section"
      aria-labelledby="decision-debt-policy-actions-title"
      data-capability-id="cwf-15-decision-debt-policy"
      data-capability-state={mutation.state}
      data-mutation-state={mutation.state}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Administrator control</p>
          <h3 id="decision-debt-policy-actions-title">Lock-window policy</h3>
          <p>{mutation.detail}</p>
        </div>
        <StatusChip {...mutation.presentation} />
      </div>

      {isAdmin === true ? (
        <div className="workspace-inline-actions">
          <button
            type="button"
            className="ghost compact"
            data-capability-action="configure-decision-debt-policy"
            disabled={!canConfigure}
            aria-expanded={editorOpen}
            onClick={() => setEditorOpen((current) => !current)}
          >
            {editorOpen ? "Close policy editor" : "Edit policy"}
          </button>
          {mutation.state === "uncertain" && typeof onReconcilePolicy === "function" && (
            <button
              type="button"
              className="ghost compact"
              data-capability-action="reconcile-decision-debt-policy"
              onClick={() => onReconcilePolicy(mutation)}
            >
              Reconcile unchanged request
            </button>
          )}
          {new Set(["error", "recovery"]).has(mutation.state) && typeof onResetMutation === "function" && (
            <button
              type="button"
              className="ghost compact"
              data-capability-action="reset-decision-debt-policy"
              onClick={() => onResetMutation(mutation)}
            >
              Reset rejected attempt
            </button>
          )}
        </div>
      ) : (
        <p className="source-note" data-policy-authority="admin-only">
          Policy changes are restricted to tenant administrators. Staff may review the server-derived priority only.
        </p>
      )}

      {isAdmin === true && editorOpen && draft && (
        <form
          className="workflow-form-section"
          data-capability-id="cwf-15-decision-debt-policy-editor"
          data-policy-version={view.policyVersion || "unversioned"}
          onSubmit={submitDraft}
        >
          <p className="source-note">
            Changes affect deterministic prioritization only. They do not resolve a dependency, alter a quote, contact a customer, or create revenue evidence.
          </p>
          <label>
            Event horizon (days)
            <input
              type="number"
              min="1"
              max="730"
              value={draft.maxEventHorizonDays}
              onChange={(event) => setDraft((current) => ({
                ...current,
                maxEventHorizonDays: Number(event.target.value)
              }))}
            />
          </label>
          <div className="workflow-form-grid">
            {decisionTypes.map(([typeId, definition]) => (
              <fieldset key={typeId} className="workflow-form-section" data-policy-decision-type={typeId}>
                <legend>{text(definition.label) || humanizeWorkspaceValue(typeId)}</legend>
                <label>
                  Lock window (days)
                  <input
                    type="number"
                    min="0"
                    max="365"
                    aria-label={`${text(definition.label) || typeId} lock window days`}
                    value={definition.lockWindowDays}
                    onChange={(event) => updateDraftType(
                      typeId,
                      "lockWindowDays",
                      event.target.value
                    )}
                  />
                </label>
                <label>
                  Dependency weight
                  <select
                    aria-label={`${text(definition.label) || typeId} dependency weight`}
                    value={definition.dependencyWeight}
                    onChange={(event) => updateDraftType(
                      typeId,
                      "dependencyWeight",
                      event.target.value
                    )}
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reversibility
                  <select
                    aria-label={`${text(definition.label) || typeId} reversibility`}
                    value={definition.reversibility}
                    onChange={(event) => updateDraftType(
                      typeId,
                      "reversibility",
                      event.target.value
                    )}
                  >
                    <option value="reversible">Reversible</option>
                    <option value="constrained">Constrained</option>
                    <option value="irreversible">Irreversible</option>
                  </select>
                </label>
              </fieldset>
            ))}
          </div>
          {!draftValid && (
            <p className="warning-note" role="alert">
              Use a 1–730 day horizon, 0–365 day lock windows, weights from 1–5, and a supported reversibility class.
            </p>
          )}
          <div className="workspace-inline-actions">
            <button
              type="submit"
              className="cta compact"
              data-capability-action="save-decision-debt-policy"
              disabled={!canConfigure || !draftValid}
            >
              Save policy change
            </button>
            <button
              type="button"
              className="ghost compact"
              data-capability-action="cancel-decision-debt-policy"
              onClick={() => {
                setDraft(buildDraft());
                setEditorOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mutation.state === "receipt" && (
        <p className="source-note" data-decision-debt-policy-receipt>
          Policy {text(mutation.receipt?.policyVersion || view.policyVersion) || "version recorded"} · {formatWorkspaceDateTime(mutation.receipt?.recordedAtISO)}
        </p>
      )}
      {text(mutation.error) && (
        <p className="warning-note" role="alert">{text(mutation.error)}</p>
      )}
    </section>
  );
}

export default function DecisionDebtPanel({
  snapshot = null,
  loading = false,
  error = "",
  stale = false,
  partial = false,
  mutation = null,
  isAdmin = false,
  onRetry,
  onConfigurePolicy,
  onReconcilePolicy,
  onResetMutation,
  onOpenQuote,
  showPolicyControls = true
}) {
  const view = buildDecisionDebtPresentation({
    snapshot,
    loading,
    error,
    stale,
    partial,
    mutation
  });
  const items = Array.isArray(view.snapshot?.items) ? view.snapshot.items : [];
  const bounds = view.snapshot?.bounds || {};
  return (
    <section
      className="workflow-form-section"
      aria-labelledby="decision-debt-title"
      data-capability-id="cwf-15-decision-debt"
      data-capability-state={view.state}
      data-read-truncation={view.state === "partial" ? "truncated" : view.snapshotAvailable ? "complete" : "unknown"}
      data-mutation-state={view.mutation.state}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Commercial dependency graph</p>
          <h2 id="decision-debt-title">Decision Debt</h2>
          <p>{view.detail}</p>
        </div>
        <StatusChip {...view.presentation} />
      </div>

      <p className="source-note" data-proof-boundary="deterministic-not-predictive">
        Deterministic operational priority only—no predictive AI. Scores are not accounting revenue, payment, booking, acceptance, completion, or customer-contact evidence.
      </p>

      {text(error) && (
        <p className="warning-note" role="alert" data-decision-debt-read-error>
          {text(error)}
        </p>
      )}

      {view.snapshotAvailable && (
        <div className="staff-evidence-rail" aria-label="Decision Debt source and bounds">
          <span>Observed {formatWorkspaceDateTime(view.snapshot.observedAtISO)}</span>
          <span>Tenant date {formatWorkspaceDate(view.snapshot.tenantLocalDate)}</span>
          <span>{formatWorkspaceInteger(bounds.returnedCount)} of {formatWorkspaceInteger(bounds.eligibleCount)} eligible</span>
          <span>Graph {text(view.snapshot.graph?.graphVersion) || "version unavailable"}</span>
          <span>Formula {text(view.snapshot.formulaVersion) || "version unavailable"}</span>
        </div>
      )}

      {view.state === "partial" && (
        <p className="warning-note" role="status" data-capability-state="partial">
          Only {formatWorkspaceInteger(bounds.returnedCount)} of {formatWorkspaceInteger(bounds.eligibleCount)} eligible decisions are shown; hidden decisions remain unresolved.
        </p>
      )}

      {view.state === "stale" && (
        <p className="warning-note" role="alert" data-retained-snapshot="stale">
          Retained observation {formatWorkspaceDateTime(view.snapshot?.observedAtISO)}. Refresh before authorizing time-sensitive work.
        </p>
      )}

      {new Set(["error", "stale"]).has(view.state) && typeof onRetry === "function" && (
        <button
          type="button"
          className="ghost compact"
          data-capability-state="recovery"
          data-capability-action="retry-decision-debt"
          onClick={() => onRetry()}
        >
          Retry Decision Debt read
        </button>
      )}

      {view.snapshotAvailable && showPolicyControls && (
        <PolicySummary policy={view.snapshot.policy} />
      )}

      {view.snapshotAvailable && items.length > 0 && (
        <div className="customer-revenue-opportunities" data-decision-debt-count={items.length}>
          {items.map((item) => (
            <DecisionDebtItem key={item.id} item={item} onOpenQuote={onOpenQuote} />
          ))}
        </div>
      )}

      {view.state === "empty" && (
        <div className="empty-state" data-capability-state="empty">
          <h3>No current unresolved Decision Debt</h3>
          <p>A future refresh can surface a decision as its configured lock window approaches.</p>
        </div>
      )}

      {showPolicyControls && (
        <PolicyMutation
          view={view}
          isAdmin={isAdmin}
          onConfigurePolicy={onConfigurePolicy}
          onReconcilePolicy={onReconcilePolicy}
          onResetMutation={onResetMutation}
        />
      )}
    </section>
  );
}
