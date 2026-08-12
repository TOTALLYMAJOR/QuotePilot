import StatusChip from "./StatusChip";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";
import { normalizeRevenueAutopilotReviewRequestUrl } from "../lib/revenueAutopilotClient";

const READ_STATES = new Set([
  "loading",
  "empty",
  "success",
  "stale",
  "partial",
  "error",
  "recovery"
]);

const MUTATION_STATES = new Set([
  "ready",
  "submitting",
  "uncertain",
  "reconciliation",
  "receipt",
  "error",
  "recovery"
]);

const READ_PRESENTATION = Object.freeze({
  loading: Object.freeze({ family: "pending", label: "Loading operations" }),
  empty: Object.freeze({ family: "info", label: "No current records" }),
  success: Object.freeze({ family: "confirmed", label: "Operations current" }),
  stale: Object.freeze({ family: "action", label: "Retained snapshot" }),
  partial: Object.freeze({ family: "action", label: "Bounded snapshot" }),
  error: Object.freeze({ family: "failed", label: "Operations unavailable" }),
  recovery: Object.freeze({ family: "action", label: "Read recovery" })
});

const READ_COPY = Object.freeze({
  loading: "Reading tenant-scoped policy, jobs, and attention evidence. No outbound result is assumed while this read is in progress.",
  empty: "No materialized jobs or unread-reply attention records are present in this bounded snapshot.",
  success: "The bounded operations snapshot is current for staff review.",
  stale: "The latest read did not complete. Retained records remain visible but may no longer reflect current server state.",
  partial: "Only a bounded or incomplete operations snapshot is visible. Missing records and outcomes remain unknown.",
  error: "Follow-up automation could not be loaded, and no previous results are available.",
  recovery: "The operations read is recovering. Retained evidence, when present, must not be treated as current until the read completes."
});

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({ family: "info", label: "No action in flight" }),
  submitting: Object.freeze({ family: "pending", label: "Waiting for receipt" }),
  uncertain: Object.freeze({ family: "blocked", label: "Outcome uncertain" }),
  reconciliation: Object.freeze({ family: "pending", label: "Reconciling exact attempt" }),
  receipt: Object.freeze({ family: "confirmed", label: "Record receipt" }),
  error: Object.freeze({ family: "failed", label: "Action rejected" }),
  recovery: Object.freeze({ family: "action", label: "Action recovery" })
});

const MUTATION_COPY = Object.freeze({
  ready: "No staff operation is currently in flight.",
  submitting: "Waiting for a server receipt for the exact requested record operation. Do not repeat the action.",
  uncertain: "No definitive receipt returned. The operation is not assumed complete and the exact attempt must be reconciled before retrying.",
  reconciliation: "Checking the exact prior attempt. This does not create a second job or establish a provider outcome.",
  receipt: "A server receipt confirms only the requested record operation. It does not prove provider acceptance, delivery, customer viewing, payment, or recovered revenue.",
  error: "The server definitively rejected the operation. No successful record or outbound outcome is assumed.",
  recovery: "The rejected operation is in explicit recovery. Review current server evidence before starting a new request."
});

export const REVENUE_AUTOPILOT_OPERATION_KINDS = Object.freeze([
  Object.freeze({
    id: "quote_follow_up",
    aliases: Object.freeze(["quote_follow_up"]),
    label: "Quote follow-up",
    shortLabel: "Follow-up",
    detail: "Stops on current view, acceptance, decline, expiry, deletion, or booking evidence.",
    outbound: true
  }),
  Object.freeze({
    id: "deposit_reminder",
    aliases: Object.freeze(["deposit_reminder"]),
    label: "Deposit reminder",
    shortLabel: "Deposit",
    detail: "Requires accepted-revision scope and current verified payment evidence.",
    outbound: true
  }),
  Object.freeze({
    id: "final_balance_reminder",
    aliases: Object.freeze(["final_balance_reminder"]),
    label: "Final-balance reminder",
    shortLabel: "Final balance",
    detail: "Uses tenant-calendar event windows and one unambiguous canonical payment rail.",
    outbound: true
  }),
  Object.freeze({
    id: "post_event_review_request",
    aliases: Object.freeze(["post_event_review_request"]),
    label: "Post-event review request",
    shortLabel: "Review request",
    detail: "Runs once from the exact completed closeout and accepted revision, then self-stops if that closeout reopens.",
    outbound: true,
    requiresReviewDestination: true
  }),
  Object.freeze({
    id: "unread_reply",
    aliases: Object.freeze(["unread_reply", "unread_customer_reply"]),
    label: "Unread customer reply",
    shortLabel: "Unread reply",
    detail: "Escalates exact unread customer-message evidence into the staff attention queue.",
    outbound: false
  })
]);

export const REVENUE_AUTOPILOT_PROVIDER_OUTCOMES = Object.freeze([
  Object.freeze({ id: "provider_accepted", label: "Provider accepted", family: "provider" }),
  Object.freeze({ id: "delivered", label: "Delivered", family: "confirmed" }),
  Object.freeze({ id: "bounced", label: "Bounced", family: "failed" }),
  Object.freeze({ id: "complained", label: "Complained", family: "failed" })
]);

const JOB_PRESENTATION = Object.freeze({
  scheduled: Object.freeze({ family: "pending", label: "Scheduled record" }),
  sending: Object.freeze({ family: "provider", label: "Dispatch lease" }),
  retry_wait: Object.freeze({ family: "action", label: "Bounded retry" }),
  outcome_ambiguous: Object.freeze({ family: "blocked", label: "Reconcile outcome" }),
  provider_accepted: Object.freeze({ family: "provider", label: "Provider accepted" }),
  delivered: Object.freeze({ family: "confirmed", label: "Delivered" }),
  bounced: Object.freeze({ family: "failed", label: "Bounced" }),
  complained: Object.freeze({ family: "failed", label: "Complained" }),
  stopped: Object.freeze({ family: "confirmed", label: "Stopped" }),
  definite_failure: Object.freeze({ family: "failed", label: "Definite failure" })
});

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstBoolean(...values) {
  return values.find((value) => typeof value === "boolean");
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function canonicalKind(value) {
  const normalized = text(value, 64).toLowerCase();
  const definition = REVENUE_AUTOPILOT_OPERATION_KINDS.find((item) => (
    item.aliases.includes(normalized)
  ));
  return definition?.id || "unidentified";
}

function explicitReadState(snapshot) {
  const candidate = text(snapshot?.readState || snapshot?.read?.state, 32).toLowerCase();
  return READ_STATES.has(candidate) ? candidate : "";
}

function explicitMutationState(snapshot) {
  const supplied = snapshot?.mutationState ?? snapshot?.mutation?.state;
  const candidate = text(supplied, 32).toLowerCase();
  if (!candidate) return "ready";
  return MUTATION_STATES.has(candidate) ? candidate : "error";
}

function resolveReadState(snapshot, available) {
  const explicit = explicitReadState(snapshot);
  if (explicit) return explicit;
  if (!isRecord(snapshot)) return available === false ? "error" : "loading";
  if (available === false) return "stale";
  if (!Array.isArray(snapshot.jobs) || !Array.isArray(snapshot.attention)) return "partial";
  return snapshot.jobs.length === 0 && snapshot.attention.length === 0
    ? "empty"
    : "success";
}

function hasPartialBounds(snapshot, jobs, attention) {
  const bounds = isRecord(snapshot?.bounds) ? snapshot.bounds : {};
  const totalJobs = safeInteger(bounds.totalJobs ?? bounds.jobCount);
  const totalAttention = safeInteger(bounds.totalAttention ?? bounds.attentionCount);
  return (
    bounds.truncated === true
    || bounds.complete === false
    || (totalJobs !== null && totalJobs > jobs.length)
    || (totalAttention !== null && totalAttention > attention.length)
  );
}

function resolveSourceLabel(source) {
  if (isRecord(source)) {
    const explicit = text(source.label, 120);
    if (explicit) return explicit;
    return formatWorkspaceSource(source.kind || source.source || source.type);
  }
  return formatWorkspaceSource(source);
}

function normalizeGate(enabled, { configured = false } = {}) {
  const active = enabled === true;
  return {
    enabled: active,
    state: active ? (configured ? "configured" : "enabled") : "dormant",
    presentation: active
      ? { family: "confirmed", label: configured ? "Configured" : "Enabled" }
      : { family: "blocked", label: configured ? "Not configured" : "Dormant" }
  };
}

function normalizeReviewDestination(value) {
  try {
    const url = normalizeRevenueAutopilotReviewRequestUrl(value);
    if (!url) return { configured: false, url: "", host: "" };
    return {
      configured: true,
      url,
      host: new URL(url).hostname
    };
  } catch {
    return { configured: false, url: "", host: "" };
  }
}

function normalizePolicy(snapshot) {
  const policy = isRecord(snapshot?.policy) ? snapshot.policy : {};
  const provider = isRecord(policy.provider) ? policy.provider : {};
  const globalEnabled = firstBoolean(
    policy.global?.enabled,
    policy.globalEnabled,
    policy.runtimeEnabled,
    policy.enabled
  ) === true;
  const tenantEnabled = firstBoolean(
    policy.tenant?.enabled,
    policy.tenantEnabled,
    policy.automationEnabled
  ) === true;
  const sendsEnabled = firstBoolean(
    policy.global?.sendsEnabled,
    policy.sendsEnabled,
    policy.outboundSendsEnabled
  ) === true;
  const providerConfigured = firstBoolean(
    provider.configured,
    policy.providerConfigured
  ) === true || text(provider.state, 32).toLowerCase() === "configured";
  const reviewDestination = normalizeReviewDestination(policy.reviewRequestUrl);

  const enabledKinds = new Set(
    Array.isArray(policy.enabledKinds)
      ? policy.enabledKinds.map(canonicalKind)
      : []
  );
  const rawKinds = isRecord(policy.kinds)
    ? policy.kinds
    : isRecord(policy.kindStates)
      ? policy.kindStates
      : {};
  const kinds = Object.fromEntries(REVENUE_AUTOPILOT_OPERATION_KINDS.map((definition) => {
    const raw = definition.aliases
      .map((alias) => rawKinds[alias])
      .find((value) => value !== undefined);
    const rawRecord = isRecord(raw) ? raw : {};
    const rawState = text(rawRecord.state, 32).toLowerCase();
    const enabled = firstBoolean(
      typeof raw === "boolean" ? raw : undefined,
      rawRecord.enabled,
      enabledKinds.has(definition.id) ? true : undefined
    ) === true || rawState === "enabled";
    const explicitlyPaused = new Set(["paused", "blocked", "disabled", "dormant"]).has(rawState);
    return [definition.id, {
      enabled: enabled && !explicitlyPaused,
      configuredState: rawState || (enabled ? "enabled" : "dormant")
    }];
  }));

  return {
    version: text(policy.version || policy.policyVersion, 80),
    timeZone: text(policy.tenantTimeZone || policy.timeZone, 100),
    global: normalizeGate(globalEnabled),
    tenant: normalizeGate(tenantEnabled),
    sends: normalizeGate(sendsEnabled),
    provider: normalizeGate(providerConfigured, { configured: true }),
    reviewRequestUrl: reviewDestination.url,
    reviewRequestHost: reviewDestination.host,
    reviewRequestConfigured: reviewDestination.configured,
    kinds
  };
}

function lanePresentation({ definition, policy, gates }) {
  const kind = policy.kinds[definition.id];
  if (!kind?.enabled) {
    return {
      state: kind?.configuredState || "dormant",
      preparable: false,
      presentation: { family: "blocked", label: "Dormant" }
    };
  }
  if (definition.requiresReviewDestination && !policy.reviewRequestConfigured) {
    return {
      state: "configuration_required",
      preparable: false,
      presentation: { family: "blocked", label: "Review URL needed" }
    };
  }
  const preparable = gates.global.enabled && gates.tenant.enabled;
  if (!preparable) {
    return {
      state: "gated",
      preparable: false,
      presentation: { family: "blocked", label: "Gated" }
    };
  }
  if (definition.outbound && (!gates.sends.enabled || !gates.provider.enabled)) {
    return {
      state: "preparation_only",
      preparable: true,
      presentation: { family: "action", label: "Preparation only" }
    };
  }
  return {
    state: "enabled",
    preparable: true,
    presentation: { family: "confirmed", label: "Enabled" }
  };
}

function normalizeBounds(snapshot, jobs, attention) {
  const bounds = isRecord(snapshot?.bounds) ? snapshot.bounds : {};
  const totalJobs = safeInteger(bounds.totalJobs ?? bounds.jobCount);
  const totalAttention = safeInteger(bounds.totalAttention ?? bounds.attentionCount);
  const maximumJobs = safeInteger(bounds.maximumJobs ?? bounds.jobLimit);
  const maximumAttention = safeInteger(bounds.maximumAttention ?? bounds.attentionLimit);
  const partial = hasPartialBounds(snapshot, jobs, attention);
  const completeness = partial
    ? "truncated"
    : bounds.complete === true || (totalJobs !== null && totalAttention !== null)
      ? "complete"
      : "bounded";
  return {
    displayedJobs: jobs.length,
    totalJobs,
    maximumJobs,
    displayedAttention: attention.length,
    totalAttention,
    maximumAttention,
    completeness
  };
}

function outcomeCount(snapshot, jobs, state) {
  const explicit = safeInteger(
    snapshot?.providerOutcomes?.[state]
    ?? snapshot?.outcomes?.[state]
    ?? snapshot?.counts?.[state]
  );
  if (explicit !== null) return { value: explicit, source: "Snapshot total" };
  if (!Array.isArray(snapshot?.jobs)) return { value: null, source: "Count unavailable" };
  return {
    value: jobs.filter((job) => text(job?.state, 32).toLowerCase() === state).length,
    source: "Displayed jobs"
  };
}

function jobPresentation(state) {
  return JOB_PRESENTATION[text(state, 32).toLowerCase()]
    || { family: "failed", label: "Unverified state" };
}

function itemIdentity(item, prefix, index) {
  return text(item?.jobId || item?.attentionId || item?.id, 120) || `${prefix}-${index + 1}`;
}

function mutationTarget(snapshot, jobs) {
  const mutation = isRecord(snapshot?.mutation) ? snapshot.mutation : {};
  if (isRecord(mutation.target)) return mutation.target;
  const jobId = text(mutation.jobId, 120);
  if (jobId) return jobs.find((job) => text(job?.jobId, 120) === jobId) || mutation;
  return jobs.find((job) => text(job?.state, 32).toLowerCase() === "outcome_ambiguous") || mutation;
}

function reconciliationOutcome(snapshot) {
  const mutation = isRecord(snapshot?.mutation) ? snapshot.mutation : {};
  if (text(mutation.operation, 64).toLowerCase() !== "reconcile_job") return null;
  const state = text(mutation.reconciliationState, 32).toLowerCase();
  if (!new Set(["withheld", "provider_accepted"]).has(state)) return null;
  const reason = text(mutation.reconciliationReason, 80).toLowerCase();
  return { state, reason: /^[a-z][a-z0-9_]{0,79}$/u.test(reason) ? reason : "" };
}

export function buildRevenueAutopilotOperationsPresentation({
  snapshot = null,
  available = true
} = {}) {
  const snapshotAvailable = isRecord(snapshot);
  const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
  const attention = Array.isArray(snapshot?.attention) ? snapshot.attention : [];
  const explicitState = resolveReadState(snapshot, available);
  const incompleteCollections = isRecord(snapshot)
    && (!Array.isArray(snapshot.jobs) || !Array.isArray(snapshot.attention));
  const state = explicitState === "success" && (incompleteCollections || hasPartialBounds(snapshot, jobs, attention))
    ? "partial"
    : explicitState;
  const mutationState = explicitMutationState(snapshot);
  const reconciliation = reconciliationOutcome(snapshot);
  const policy = normalizePolicy(snapshot);
  const lanes = REVENUE_AUTOPILOT_OPERATION_KINDS.map((definition) => ({
    ...definition,
    ...lanePresentation({ definition, policy, gates: policy }),
    jobCount: jobs.filter((job) => canonicalKind(job?.kind) === definition.id).length,
    attentionCount: attention.filter((item) => (
      canonicalKind(item?.kind || "unread_reply") === definition.id
    )).length
  }));
  const hasPreparableLane = lanes.some((lane) => lane.preparable);
  const readAllowsMutation = new Set(["empty", "success"]).has(state);
  const mutationAllowsAction = new Set(["ready", "receipt", "recovery"]).has(mutationState);

  return {
    state,
    mutationState,
    snapshotAvailable,
    retained: snapshotAvailable && new Set(["loading", "stale", "partial", "recovery"]).has(state),
    detail: READ_COPY[state],
    presentation: READ_PRESENTATION[state],
    mutationDetail: mutationState === "receipt" && reconciliation?.state === "withheld"
      ? "Current authority withheld the retry before any provider call. No provider acceptance or delivery is established."
      : mutationState === "receipt" && reconciliation?.state === "provider_accepted"
        ? "The provider accepted the exact frozen request. Delivery, customer viewing, payment, and recovered revenue remain separate evidence."
        : MUTATION_COPY[mutationState],
    mutationPresentation: mutationState === "receipt" && reconciliation?.state === "withheld"
      ? { family: "blocked", label: "Dispatch withheld" }
      : mutationState === "receipt" && reconciliation?.state === "provider_accepted"
        ? { family: "provider", label: "Provider accepted" }
        : MUTATION_PRESENTATION[mutationState],
    reconciliationOutcome: reconciliation,
    policy,
    lanes,
    jobs,
    attention,
    bounds: normalizeBounds(snapshot, jobs, attention),
    sourceLabel: resolveSourceLabel(snapshot?.source),
    observedAtISO: text(snapshot?.observedAtISO || snapshot?.read?.observedAtISO, 64),
    materializeAllowed: available !== false
      && hasPreparableLane
      && readAllowsMutation
      && mutationAllowsAction,
    busy: new Set(["submitting", "reconciliation"]).has(mutationState),
    available: available !== false
  };
}

function GateCard({ gateId, eyebrow, title, detail, gate }) {
  return (
    <article className="customer-revenue-opportunity" data-automation-gate={gateId} data-gate-state={gate.state}>
      <div>
        <span className="customer-revenue-opportunity-type">{eyebrow}</span>
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
      <StatusChip {...gate.presentation} />
    </article>
  );
}

function PolicyGates({ view, onConfigure }) {
  const dormant = !view.policy.global.enabled
    || !view.policy.tenant.enabled
    || !view.policy.sends.enabled
    || !view.policy.provider.enabled;
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-gates-title">
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Activation controls</p>
          <h3 id="revenue-autopilot-gates-title">Four explicit gates</h3>
          <p className="muted">Outbound automation is dormant by default and fails closed when a gate is missing.</p>
        </div>
        {typeof onConfigure === "function" && (
          <button
            type="button"
            className="ghost compact"
            data-capability-action="configure-revenue-autopilot"
            onClick={() => onConfigure()}
          >
            Configure policy
          </button>
        )}
      </div>
      {dormant && (
        <p className="warning-note" role="status" data-automation-dormant="true">
          Dormant by default. No automated email can run until its global, tenant, outbound-send, and provider gates are enabled.
        </p>
      )}
      <div className="customer-card-list">
        <GateCard
          gateId="global"
          eyebrow="Build and runtime"
          title="Global runtime"
          detail="A release-controlled switch permits the capability to exist in this environment."
          gate={view.policy.global}
        />
        <GateCard
          gateId="tenant"
          eyebrow="Organization policy"
          title="Tenant automation"
          detail="The organization explicitly opts into governed automation under its current policy."
          gate={view.policy.tenant}
        />
        <GateCard
          gateId="sends"
          eyebrow="Release kill switch"
          title="Outbound sends"
          detail="A separate release-controlled switch permits prepared records to reach the provider."
          gate={view.policy.sends}
        />
        <GateCard
          gateId="provider"
          eyebrow="Delivery readiness"
          title="Email provider"
          detail="A current approved provider configuration is required for outbound kinds."
          gate={view.policy.provider}
        />
      </div>
    </section>
  );
}

function OperationLanes({ view }) {
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-lanes-title">
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Policy lanes</p>
          <h3 id="revenue-autopilot-lanes-title">Five independently governed lanes</h3>
          <p className="muted">Four outbound email lanes and one unread-reply attention lane remain independently gated.</p>
        </div>
      </div>
      <div className="customer-card-list">
        {view.lanes.map((lane) => (
          <article
            className="customer-revenue-opportunity"
            key={lane.id}
            data-automation-kind={lane.id}
            data-automation-state={lane.state}
          >
            <div>
              <span className="customer-revenue-opportunity-type">{lane.outbound ? "Tenant-branded email" : "Staff attention"}</span>
              <h4>{lane.label}</h4>
              <p>{lane.detail}</p>
              {lane.requiresReviewDestination && (
                <p
                  className={view.policy.reviewRequestConfigured ? "source-note" : "warning-note"}
                  data-review-request-state={view.policy.reviewRequestConfigured ? "configured" : "configuration_required"}
                >
                  {view.policy.reviewRequestConfigured
                    ? `Tenant review destination: ${view.policy.reviewRequestHost}`
                    : "A tenant-approved public HTTPS review destination is required before this lane can run."}
                </p>
              )}
              <p className="source-note">
                {formatWorkspaceInteger(lane.jobCount)} displayed jobs
                {lane.id === "unread_reply"
                  ? ` · ${formatWorkspaceInteger(lane.attentionCount)} attention records`
                  : ""}
              </p>
            </div>
            <StatusChip {...lane.presentation} />
          </article>
        ))}
      </div>
    </section>
  );
}

function ProviderEvidence({ snapshot, jobs }) {
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-provider-title">
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Provider evidence</p>
          <h3 id="revenue-autopilot-provider-title">Outcomes stay separate</h3>
          <p className="muted">Each total represents one exact recorded state. Later states are not folded into earlier ones.</p>
        </div>
      </div>
      <dl className="staff-evidence-details">
        {REVENUE_AUTOPILOT_PROVIDER_OUTCOMES.map((outcome) => {
          const count = outcomeCount(snapshot, jobs, outcome.id);
          return (
            <div key={outcome.id} data-provider-outcome={outcome.id}>
              <dt>{outcome.label}</dt>
              <dd>
                {count.value === null ? "Unavailable" : formatWorkspaceInteger(count.value)}
                <small>{count.source}</small>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="staff-evidence-caveat">
        Provider accepted is not delivered. Delivered is not customer viewed. A bounce or complaint is suppression evidence, not a payment or revenue result.
      </p>
    </section>
  );
}

function JobCard({ job, index, view, onReconcile }) {
  const state = text(job?.state, 32).toLowerCase();
  const kind = canonicalKind(job?.kind);
  const definition = REVENUE_AUTOPILOT_OPERATION_KINDS.find((item) => item.id === kind);
  const identity = itemIdentity(job, "job", index);
  const reconcile = state === "outcome_ambiguous" && typeof onReconcile === "function";
  return (
    <li className="command-center-row" data-job-id={identity} data-job-state={state || "unverified"}>
      <div className="command-center-row-main">
        <span className="customer-revenue-opportunity-type">{definition?.shortLabel || "Unidentified kind"}</span>
        <strong>{formatWorkspaceText(job?.quoteLabel || job?.customerLabel, { emptyLabel: "Authoritative quote" })}</strong>
        <p className="command-center-row-detail">
          Due {formatWorkspaceDate(job?.dueTenantDate, { emptyLabel: "date not recorded" })}
          {text(job?.occurrenceKey || job?.window, 80)
            ? ` · ${humanizeWorkspaceValue(job.occurrenceKey || job.window)}`
            : ""}
        </p>
        <p className="command-center-row-meta">
          Attempt {formatWorkspaceInteger(job?.attemptCount, { emptyLabel: "not recorded" })}
          {safeInteger(job?.maxAttempts) !== null
            ? ` of ${formatWorkspaceInteger(job.maxAttempts)}`
            : ""}
        </p>
        {text(job?.dispatchSuppressedAtISO, 64) && (
          <p className="warning-note" data-dispatch-suppressed="true">
            Future dispatch suppressed: {humanizeWorkspaceValue(
              job?.dispatchSuppressionReason || "current authority changed"
            )}. The recorded provider outcome remains unchanged.
          </p>
        )}
      </div>
      <div className="right-actions">
        <StatusChip {...jobPresentation(state)} />
        {reconcile && (
          <button
            type="button"
            className="ghost compact"
            disabled={!view.available || view.busy}
            data-capability-action="reconcile-revenue-autopilot-job"
            onClick={() => onReconcile(job)}
          >
            Reconcile exact attempt
          </button>
        )}
      </div>
    </li>
  );
}

function JobQueue({ view, onReconcile }) {
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-jobs-title">
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Materialized records</p>
          <h3 id="revenue-autopilot-jobs-title">Bounded job queue</h3>
          <p className="muted">A scheduled record is not a send. Dispatch and provider evidence remain separate transitions.</p>
        </div>
      </div>
      {view.jobs.length > 0 ? (
        <ol className="command-center-list">
          {view.jobs.map((job, index) => (
            <JobCard
              key={itemIdentity(job, "job", index)}
              job={job}
              index={index}
              view={view}
              onReconcile={onReconcile}
            />
          ))}
        </ol>
      ) : (
        <p className="muted" data-operations-empty="jobs">No materialized jobs are present in this snapshot.</p>
      )}
    </section>
  );
}

function AttentionQueue({ view, onOpenConversation, onAcknowledgeReply }) {
  return (
    <section className="workflow-form-section" aria-labelledby="revenue-autopilot-attention-title">
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Human attention</p>
          <h3 id="revenue-autopilot-attention-title">Unread reply escalation</h3>
          <p className="muted">Message content stays in the quote conversation. This queue exposes only bounded staff attention evidence.</p>
        </div>
      </div>
      {view.attention.length > 0 ? (
        <ol className="command-center-list">
          {view.attention.map((item, index) => {
            const identity = itemIdentity(item, "attention", index);
            const state = text(item?.state, 32).toLowerCase() || "open";
            const acknowledged = new Set(["acknowledged", "resolved", "closed"]).has(state);
            return (
              <li
                className="command-center-row"
                key={identity}
                tabIndex={-1}
                data-attention-id={identity}
                data-attention-state={state}
              >
                <div className="command-center-row-main">
                  <span className="customer-revenue-opportunity-type">Customer reply</span>
                  <strong>{formatWorkspaceText(item?.quoteLabel || item?.customerLabel, { emptyLabel: "Authoritative quote conversation" })}</strong>
                  <p className="command-center-row-detail">
                    Received {formatWorkspaceDateTime(item?.receivedAtISO || item?.createdAtISO, { emptyLabel: "time not recorded" })}
                  </p>
                  <p className="command-center-row-meta">
                    Open the authoritative quote conversation to read or reply. Manual acknowledgement records handling only; it does not claim the message was rendered or read.
                  </p>
                </div>
                <div className="right-actions">
                  <StatusChip
                    family={acknowledged ? "confirmed" : "action"}
                    label={acknowledged ? "Handled manually" : "Needs review"}
                  />
                  {typeof onOpenConversation === "function" && (
                    <button
                      type="button"
                      className="cta compact"
                      disabled={!view.available || view.busy || !text(item?.quoteId, 256)}
                      data-capability-action="open-unread-reply-conversation"
                      onClick={() => onOpenConversation(item)}
                    >
                      Open conversation
                    </button>
                  )}
                  {!acknowledged && typeof onAcknowledgeReply === "function" && (
                    <button
                      type="button"
                      className="ghost compact"
                      disabled={
                        !view.available
                        || view.busy
                        || !text(item?.quoteId, 256)
                        || !text(item?.messageId, 256)
                      }
                      data-capability-action="manual-acknowledge-unread-reply"
                      onClick={() => onAcknowledgeReply(item)}
                    >
                      Mark handled manually
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted" data-operations-empty="attention">No unread-reply attention records are present in this snapshot.</p>
      )}
    </section>
  );
}

function SnapshotEvidence({ view }) {
  const jobTotal = view.bounds.totalJobs === null
    ? `${formatWorkspaceInteger(view.bounds.displayedJobs)} displayed`
    : `${formatWorkspaceInteger(view.bounds.displayedJobs)} of ${formatWorkspaceInteger(view.bounds.totalJobs)}`;
  const attentionTotal = view.bounds.totalAttention === null
    ? `${formatWorkspaceInteger(view.bounds.displayedAttention)} displayed`
    : `${formatWorkspaceInteger(view.bounds.displayedAttention)} of ${formatWorkspaceInteger(view.bounds.totalAttention)}`;
  return (
    <dl className="staff-evidence-details">
      <div>
        <dt>Read source</dt>
        <dd>{view.sourceLabel}<small>Tenant-scoped staff projection</small></dd>
      </div>
      <div>
        <dt>Observed</dt>
        <dd>{formatWorkspaceDateTime(view.observedAtISO, { emptyLabel: "Time not recorded" })}</dd>
      </div>
      <div>
        <dt>Policy</dt>
        <dd>{formatWorkspaceText(view.policy.version, { emptyLabel: "Version not recorded" })}<small>{formatWorkspaceText(view.policy.timeZone, { emptyLabel: "Tenant time zone not recorded" })}</small></dd>
      </div>
      <div data-review-request-configuration={view.policy.reviewRequestConfigured ? "configured" : "not_configured"}>
        <dt>Review ask destination</dt>
        <dd>
          {view.policy.reviewRequestConfigured ? "Configured" : "Not configured"}
          <small>{view.policy.reviewRequestConfigured
            ? view.policy.reviewRequestHost
            : "Required only when the post-event review lane is enabled"}</small>
        </dd>
      </div>
      <div>
        <dt>Job bounds</dt>
        <dd>{jobTotal}<small>{view.bounds.maximumJobs === null ? "Maximum not recorded" : `Hard maximum ${formatWorkspaceInteger(view.bounds.maximumJobs)}`}</small></dd>
      </div>
      <div>
        <dt>Attention bounds</dt>
        <dd>{attentionTotal}<small>{view.bounds.maximumAttention === null ? "Maximum not recorded" : `Hard maximum ${formatWorkspaceInteger(view.bounds.maximumAttention)}`}</small></dd>
      </div>
      <div>
        <dt>Completeness</dt>
        <dd>{humanizeWorkspaceValue(view.bounds.completeness)}<small>Missing records remain unknown</small></dd>
      </div>
    </dl>
  );
}

function MutationRail({ snapshot, view, onMaterialize, onReconcile }) {
  const target = mutationTarget(snapshot, view.jobs);
  const materializationSummary = (
    snapshot?.mutation?.operation === "materialize_jobs"
    && isRecord(snapshot?.mutation?.materializationSummary)
  ) ? snapshot.mutation.materializationSummary : null;
  const canReconcile = new Set(["uncertain", "reconciliation"]).has(view.mutationState)
    && typeof onReconcile === "function";
  return (
    <section
      className={`staff-evidence-rail staff-evidence-${view.mutationState === "error" ? "unavailable" : view.mutationState}`}
      aria-labelledby="revenue-autopilot-mutation-title"
      aria-live="polite"
      aria-busy={view.busy}
      data-capability-id="cwf-12-revenue-autopilot-mutation"
      data-capability-state={view.mutationState}
      data-mutation-state={view.mutationState}
      data-reconciliation-state={view.reconciliationOutcome?.state || "not_applicable"}
    >
      <div className="staff-evidence-head">
        <div>
          <p className="eyebrow">Controlled operation</p>
          <h3 id="revenue-autopilot-mutation-title">Record mutation state</h3>
        </div>
        <div className="right-actions">
          <StatusChip {...view.mutationPresentation} />
          {canReconcile && (
            <button
              type="button"
              className="cta compact"
              disabled={!view.available || view.mutationState === "reconciliation"}
              data-capability-action="reconcile-revenue-autopilot-mutation"
              onClick={() => onReconcile(target)}
            >
              {view.mutationState === "reconciliation" ? "Reconciliation in progress" : "Reconcile exact attempt"}
            </button>
          )}
        </div>
      </div>
      <p
        className={new Set(["uncertain", "error", "recovery"]).has(view.mutationState) ? "warning-note" : "source-note"}
        role={new Set(["uncertain", "error"]).has(view.mutationState) ? "alert" : "status"}
      >
        {view.mutationDetail}
      </p>
      {view.reconciliationOutcome?.state === "withheld" && view.reconciliationOutcome.reason && (
        <p className="source-note" data-reconciliation-reason={view.reconciliationOutcome.reason}>
          Authority reason: {humanizeWorkspaceValue(view.reconciliationOutcome.reason)}
        </p>
      )}
      {materializationSummary && (
        <div
          className="workflow-policy-summary"
          data-materialization-summary="bounded"
          aria-label="Prepared record results"
        >
          <p className="source-note">
            Prepared {formatWorkspaceInteger(materializationSummary.createdCount)} new records
            {` · updated ${formatWorkspaceInteger(materializationSummary.updatedCount)}`}
          </p>
          <ul className="command-center-list">
            {REVENUE_AUTOPILOT_OPERATION_KINDS
              .filter((definition) => definition.outbound)
              .map((definition) => {
                const lane = materializationSummary.lanes?.[definition.id] || {};
                return (
                  <li
                    className="command-center-row"
                    key={definition.id}
                    data-materialization-lane={definition.id}
                    data-materialization-state={text(lane.state, 32) || "unavailable"}
                  >
                    <div className="command-center-row-main">
                      <strong>{definition.label}</strong>
                      <p className="command-center-row-detail">
                        {humanizeWorkspaceValue(lane.state || "unavailable")}
                        {` · ${formatWorkspaceInteger(lane.createCount)} new`}
                        {` · ${formatWorkspaceInteger(lane.updateCount)} updated`}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
      {typeof onMaterialize === "function" && (
        <div className="right-actions">
          <button
            type="button"
            className="cta compact"
            disabled={!view.materializeAllowed}
            title={view.materializeAllowed
              ? "Create or reconcile bounded due records from current server evidence."
              : "Current read, mutation, and policy gates do not permit materialization."}
            data-capability-action="materialize-revenue-autopilot-jobs"
            onClick={() => onMaterialize(snapshot)}
          >
            Prepare due records
          </button>
          <p className="source-note">This action prepares governed records. It does not itself send an email.</p>
        </div>
      )}
    </section>
  );
}

export default function RevenueAutopilotOperations({
  snapshot = null,
  available = true,
  onConfigure,
  onMaterialize,
  onReconcile,
  onOpenConversation,
  onAcknowledgeReply
}) {
  const view = buildRevenueAutopilotOperationsPresentation({ snapshot, available });
  const readBusy = new Set(["loading", "recovery"]).has(view.state);
  const alertState = new Set(["stale", "partial", "error"]).has(view.state);

  return (
    <section
      className={`customer-relationship-briefing customer-revenue-opportunities staff-evidence-${view.state}`}
      aria-labelledby="revenue-autopilot-operations-title"
      aria-busy={readBusy || view.busy}
      data-capability-id="cwf-12-revenue-autopilot-operations"
      data-capability-state={view.state}
      data-read-state={view.state}
      data-read-truncation={view.bounds.completeness}
      data-capability-available={view.available ? "true" : "false"}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Follow-up and payment reminders</p>
          <h2 id="revenue-autopilot-operations-title">Follow-up automation</h2>
          <p className="muted">Governed follow-ups, payment reminders, post-event review asks, and unread-reply escalation with explicit evidence boundaries.</p>
        </div>
        <StatusChip {...view.presentation} />
      </div>

      <div className="staff-evidence-rail staff-evidence-current" data-proof-boundary="commercial-evidence">
        <div className="staff-evidence-head">
          <div>
            <p className="eyebrow">Evidence limits</p>
            <h3>What these records do not prove</h3>
          </div>
          <StatusChip family="confirmed" label="Evidence separated" />
        </div>
        <p className="staff-evidence-caveat">
          A prepared job is not a sent email. Provider acceptance is not delivery. Delivery is not customer viewing. A review ask does not prove an external review, attribution, or recovered revenue. Payment reminders do not prove money received or recovered revenue.
        </p>
      </div>

      <p
        className={view.state === "success" || view.state === "empty" ? "source-note" : "warning-note"}
        role={alertState ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
      >
        {view.detail}
      </p>

      {view.snapshotAvailable && (
        <>
          <SnapshotEvidence view={view} />
          <PolicyGates view={view} onConfigure={onConfigure} />
          <OperationLanes view={view} />
          <ProviderEvidence snapshot={snapshot} jobs={view.jobs} />
          <div className="workflow-form-grid">
            <JobQueue view={view} onReconcile={onReconcile} />
            <AttentionQueue
              view={view}
              onOpenConversation={onOpenConversation}
              onAcknowledgeReply={onAcknowledgeReply}
            />
          </div>
        </>
      )}

      <MutationRail
        snapshot={snapshot}
        view={view}
        onMaterialize={onMaterialize}
        onReconcile={onReconcile}
      />
    </section>
  );
}
