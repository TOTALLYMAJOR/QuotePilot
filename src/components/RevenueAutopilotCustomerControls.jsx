import { useEffect, useMemo, useState } from "react";
import StatusChip from "./StatusChip";
import {
  configureRevenueAutopilotCustomerControls,
  readPendingRevenueAutopilotCustomerControlsAttempt,
  resetDefinitiveRevenueAutopilotCustomerControlsAttempt
} from "../lib/revenueAutopilotClient";
import { normalizeRevenueAutopilotEmailControlsProjection } from "../lib/customerWorkspace";
import { formatWorkspaceDateTime } from "../lib/workspacePresentation";

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({ family: "info", label: "Ready for review" }),
  submitting: Object.freeze({ family: "pending", label: "Saving controls" }),
  uncertain: Object.freeze({ family: "action", label: "Outcome uncertain" }),
  reconciliation: Object.freeze({ family: "pending", label: "Reconciling receipt" }),
  receipt: Object.freeze({ family: "confirmed", label: "Controls recorded" }),
  error: Object.freeze({ family: "failed", label: "Controls rejected" }),
  recovery: Object.freeze({ family: "action", label: "Correction ready" }),
  restricted: Object.freeze({ family: "blocked", label: "Admin controlled" })
});

const MUTATION_COPY = Object.freeze({
  ready: "Choose both channel-control states from documented customer evidence before saving.",
  submitting: "The exact request is in flight. Do not repeat it or change the selected evidence.",
  uncertain: "The result is unknown. Reconcile this unchanged request before any new control change.",
  reconciliation: "QuotePilot is checking the same request identity; no second control change is being created.",
  receipt: "The server recorded this exact control request. No email was scheduled or sent.",
  error: "The server rejected this exact request. No control change or outbound result is assumed.",
  recovery: "The rejected attempt was safely reset. Review the evidence before submitting a corrected request.",
  restricted: "Only tenant administrators can change customer email consent and reminder subscription records."
});

const CONTROL_PRESENTATION = Object.freeze({
  granted: Object.freeze({ family: "confirmed", label: "Consent granted" }),
  revoked: Object.freeze({ family: "blocked", label: "Consent revoked" }),
  subscribed: Object.freeze({ family: "confirmed", label: "Subscribed" }),
  unsubscribed: Object.freeze({ family: "blocked", label: "Unsubscribed" }),
  not_configured: Object.freeze({ family: "info", label: "Not configured" }),
  unavailable: Object.freeze({ family: "failed", label: "Current state unavailable" })
});

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeControls(controls) {
  if (!isRecord(controls)) return null;
  const authorityState = text(controls.authorityState).toLowerCase();
  const revision = Number(controls.revision);
  if (authorityState === "dormant") {
    if (!Number.isSafeInteger(revision) || revision !== 0) return null;
    return {
      authorityState,
      revision,
      consentState: "not_configured",
      subscriptionState: "not_configured",
      consentRecordedAtISO: "",
      subscriptionRecordedAtISO: "",
      observedAtISO: text(controls.observedAtISO),
      source: "server_read"
    };
  }
  const consentState = text(controls.consent?.state || controls.consentState).toLowerCase();
  const subscriptionState = text(
    controls.subscription?.state || controls.subscriptionState
  ).toLowerCase();
  if (
    !Number.isSafeInteger(revision)
    || revision < 1
    || !new Set(["granted", "revoked"]).has(consentState)
    || !new Set(["subscribed", "unsubscribed"]).has(subscriptionState)
    || (consentState === "revoked" && subscriptionState === "subscribed")
  ) {
    return null;
  }
  return {
    authorityState: "configured",
    revision,
    consentState,
    subscriptionState,
    consentRecordedAtISO: text(
      controls.consent?.recordedAtISO || controls.consentRecordedAtISO || controls.recordedAtISO
    ),
    subscriptionRecordedAtISO: text(
      controls.subscription?.recordedAtISO
      || controls.subscriptionRecordedAtISO
      || controls.recordedAtISO
    ),
    observedAtISO: text(controls.observedAtISO),
    source: text(controls.source) === "exact_receipt" ? "exact_receipt" : "server_read"
  };
}

function mutationFromPending(pending) {
  if (!isRecord(pending)) return null;
  return {
    state: pending.definitive === true ? "error" : "uncertain",
    requestId: text(pending.requestId),
    error: text(pending.error),
    definitive: pending.definitive === true,
    pending: true
  };
}

export function buildRevenueAutopilotCustomerControlsPresentation({
  isAdmin = false,
  mutation = null,
  recordedControls = null,
  projectionStale = false,
  projectionError = ""
} = {}) {
  const requestedState = isAdmin ? text(mutation?.state).toLowerCase() || "ready" : "restricted";
  const state = Object.prototype.hasOwnProperty.call(MUTATION_PRESENTATION, requestedState)
    ? requestedState
    : "error";
  const controls = normalizeControls(recordedControls);
  const projectionAvailable = Boolean(controls);
  const availability = !isAdmin
    ? "restricted"
    : projectionStale
      ? "stale"
      : projectionAvailable
        ? "available"
        : "unavailable";
  const unresolved = mutation?.pending === true
    || new Set(["submitting", "uncertain", "reconciliation", "error"]).has(state)
      && Boolean(text(mutation?.requestId));
  return {
    state,
    presentation: MUTATION_PRESENTATION[state],
    detail: MUTATION_COPY[state],
    headerPresentation: unresolved
      ? MUTATION_PRESENTATION[state]
      : availability === "unavailable"
      ? { family: "failed", label: "Current controls unavailable" }
      : availability === "stale"
        ? { family: "action", label: "Control read may be stale" }
        : MUTATION_PRESENTATION[state],
    headerDetail: unresolved
      ? MUTATION_COPY[state]
      : availability === "unavailable"
      ? `${text(projectionError) || "The authoritative customer-control projection is unavailable."} No current state is assumed and new changes are locked.`
      : availability === "stale"
        ? "The saved customer controls may be out of date. Refresh the client overview before changing them."
        : MUTATION_COPY[state],
    controls,
    availability,
    projectionAvailable,
    projectionStale: projectionStale === true,
    unresolved,
    busy: new Set(["submitting", "reconciliation"]).has(state),
    canReconcile: state === "uncertain" && mutation?.pending === true,
    canReset: state === "error" && mutation?.definitive === true && mutation?.pending === true
  };
}

function ControlStatus({ label, state, recordedAtISO = "", observedAtISO = "" }) {
  const presentation = CONTROL_PRESENTATION[state] || CONTROL_PRESENTATION.unavailable;
  return (
    <article className="commercial-measure-card" data-email-control={label.toLowerCase()} data-email-control-state={state || "unknown"}>
      <span>{label}</span>
      <StatusChip {...presentation} />
      <small>
        {recordedAtISO
          ? `Recorded ${formatWorkspaceDateTime(recordedAtISO)}`
          : state === "not_configured" && observedAtISO
            ? `No configured record as of ${formatWorkspaceDateTime(observedAtISO)}`
            : "No authoritative current-state projection is available."}
      </small>
    </article>
  );
}

export default function RevenueAutopilotCustomerControls({
  organizationId = "",
  customerId = "",
  controls = null,
  isAdmin = false,
  projectionStale = false,
  projectionError = "",
  onRefresh,
  onReceipt
}) {
  const scopeKey = `${text(organizationId)}\u0000${text(customerId)}`;
  const initialProjection = useMemo(() => normalizeRevenueAutopilotEmailControlsProjection(
    controls,
    { organizationId, customerId }
  ), [controls, customerId, organizationId]);
  const initialControls = useMemo(() => normalizeControls(initialProjection), [initialProjection]);
  const [form, setForm] = useState({
    consentState: "",
    subscriptionState: "",
    evidenceConfirmed: false
  });
  const [mutation, setMutation] = useState({ state: isAdmin ? "ready" : "restricted" });
  const [recordedControls, setRecordedControls] = useState(initialProjection);

  useEffect(() => {
    setRecordedControls(initialProjection);
    if (!isAdmin || !text(organizationId) || !text(customerId)) {
      setForm({ consentState: "", subscriptionState: "", evidenceConfirmed: false });
      setMutation({ state: isAdmin ? "error" : "restricted", error: isAdmin ? "Customer email-control scope is unavailable." : "" });
      return;
    }
    let pending = null;
    try {
      pending = readPendingRevenueAutopilotCustomerControlsAttempt({
        organizationId,
        customerId
      });
    } catch (error) {
      setMutation({ state: "error", error: error?.message || "Customer email controls could not be prepared." });
      return;
    }
    if (pending) {
      setForm({
        consentState: text(pending.consentState),
        subscriptionState: text(pending.subscriptionState),
        evidenceConfirmed: true
      });
      setMutation(mutationFromPending(pending));
      return;
    }
    setForm({
      consentState: new Set(["granted", "revoked"]).has(initialControls?.consentState)
        ? initialControls.consentState
        : "",
      subscriptionState: new Set(["subscribed", "unsubscribed"]).has(initialControls?.subscriptionState)
        ? initialControls.subscriptionState
        : "",
      evidenceConfirmed: false
    });
    setMutation({ state: "ready" });
  }, [customerId, initialControls, initialProjection, isAdmin, organizationId, scopeKey]);

  const view = buildRevenueAutopilotCustomerControlsPresentation({
    isAdmin,
    mutation,
    recordedControls,
    projectionStale,
    projectionError
  });
  const selectionValid = new Set(["granted", "revoked"]).has(form.consentState)
    && new Set(["subscribed", "unsubscribed"]).has(form.subscriptionState)
    && !(form.consentState === "revoked" && form.subscriptionState === "subscribed");
  const formLocked = !isAdmin
    || !view.projectionAvailable
    || view.projectionStale
    || view.unresolved
    || view.busy;
  const canSubmit = isAdmin
    && selectionValid
    && form.evidenceConfirmed
    && !formLocked
    && text(organizationId)
    && text(customerId);

  const updateForm = (patch) => {
    if (formLocked) return;
    setForm((current) => ({ ...current, ...patch }));
    if (new Set(["receipt", "recovery", "error"]).has(mutation.state) && !mutation.pending) {
      setMutation({ state: "ready" });
    }
  };

  const settleError = (error) => {
    let pending = null;
    try {
      pending = readPendingRevenueAutopilotCustomerControlsAttempt({ organizationId, customerId });
    } catch {
      pending = null;
    }
    setMutation(pending
      ? mutationFromPending(pending)
      : {
          state: "error",
          error: error?.message || "Customer email controls were not recorded.",
          pending: false,
          definitive: false
        });
  };

  const recordReceipt = (result, submitted) => {
    const recordedAtISO = result.receipt.recordedAtISO;
    const nextControls = {
      authorityState: "configured",
      revision: submitted.expectedRevision + 1,
      consentState: submitted.consentState,
      subscriptionState: submitted.subscriptionState,
      consentRecordedAtISO: recordedAtISO,
      subscriptionRecordedAtISO: recordedAtISO,
      observedAtISO: recordedAtISO,
      source: "exact_receipt"
    };
    setRecordedControls(nextControls);
    setForm((current) => ({ ...current, evidenceConfirmed: false }));
    setMutation({
      state: "receipt",
      receipt: result.receipt,
      requestId: result.receipt.requestId,
      pending: false,
      definitive: false
    });
    onReceipt?.({ ...result, controls: nextControls });
  };

  const submitControls = async () => {
    if (!canSubmit) return;
    const submitted = {
      organizationId: text(organizationId),
      customerId: text(customerId),
      expectedRevision: view.controls.revision,
      consentState: form.consentState,
      subscriptionState: form.subscriptionState
    };
    setMutation({ state: "submitting", pending: true });
    try {
      const result = await configureRevenueAutopilotCustomerControls(submitted);
      recordReceipt(result, submitted);
    } catch (error) {
      settleError(error);
    }
  };

  const reconcileControls = async () => {
    let pending = null;
    try {
      pending = readPendingRevenueAutopilotCustomerControlsAttempt({ organizationId, customerId });
    } catch (error) {
      settleError(error);
      return;
    }
    if (!pending || pending.definitive === true) {
      settleError(new Error("The exact unresolved customer-control request is unavailable."));
      return;
    }
    const submitted = {
      organizationId: pending.organizationId,
      customerId: pending.customerId,
      expectedRevision: pending.expectedRevision,
      consentState: pending.consentState,
      subscriptionState: pending.subscriptionState,
      requestId: pending.requestId
    };
    setMutation({ ...mutationFromPending(pending), state: "reconciliation" });
    try {
      const result = await configureRevenueAutopilotCustomerControls(submitted);
      recordReceipt(result, submitted);
    } catch (error) {
      settleError(error);
    }
  };

  const resetRejectedAttempt = () => {
    if (!view.canReset) return;
    const reset = resetDefinitiveRevenueAutopilotCustomerControlsAttempt({
      organizationId,
      customerId,
      requestId: mutation.requestId
    });
    if (!reset) {
      setMutation({ ...mutation, error: "The rejected request could not be safely reset." });
      return;
    }
    setForm((current) => ({ ...current, evidenceConfirmed: false }));
    setMutation({ state: "recovery", pending: false, definitive: false });
  };

  const consentState = view.controls?.consentState || "unavailable";
  const subscriptionState = view.controls?.subscriptionState || "unavailable";
  const capabilityState = !isAdmin
    ? "restricted"
    : view.availability === "unavailable"
      ? "unavailable"
      : view.availability === "stale"
        ? "stale"
        : view.state;
  return (
    <section
      className="workflow-form-section"
      aria-labelledby="revenue-autopilot-customer-controls-title"
      data-capability-id="cwf-12-customer-email-controls-mutation"
      data-capability-state={view.state}
      data-mutation-state={view.state}
      data-email-controls-surface-state={capabilityState}
      data-role-gate={isAdmin ? "admin" : "restricted"}
      data-email-controls-availability={view.availability}
    >
      <div className="workspace-route-head">
        <div>
          <p className="eyebrow">Follow-up automation</p>
          <h2 id="revenue-autopilot-customer-controls-title">Customer email controls</h2>
          <p>{view.headerDetail}</p>
        </div>
        <StatusChip {...view.headerPresentation} />
      </div>

      <p className="source-note" data-proof-boundary="controls-not-delivery">
        Consent and subscription are email-channel eligibility records only. They do not enable tenant automation, schedule or send a message, prove provider acceptance or delivery, establish a customer view, or verify payment.
      </p>

      <div className="customer-revenue-metrics" aria-label="Customer email-control evidence">
        <ControlStatus
          label="Consent"
          state={consentState}
          recordedAtISO={view.controls?.consentRecordedAtISO}
          observedAtISO={view.controls?.observedAtISO}
        />
        <ControlStatus
          label="Subscription"
          state={subscriptionState}
          recordedAtISO={view.controls?.subscriptionRecordedAtISO}
          observedAtISO={view.controls?.observedAtISO}
        />
      </div>

      {view.controls && (
        <p className="source-note" data-email-controls-projection-evidence>
          {view.controls.source === "exact_receipt" ? "Exact mutation receipt" : "Server projection"}
          {` · revision ${view.controls.revision} · observed ${formatWorkspaceDateTime(view.controls.observedAtISO)}`}
        </p>
      )}

      {!isAdmin ? (
        <p className="warning-note" data-capability-state="restricted">
          Ask a tenant administrator to review documented email consent and subscription evidence.
        </p>
      ) : (
        <div className="workflow-form-grid">
          {new Set(["unavailable", "stale"]).has(view.availability) && (
            <div className="warning-note" role="status" data-email-controls-read={view.availability}>
              <span>
                {view.availability === "unavailable"
                  ? `${text(projectionError) || "Current controls were not returned by the server projection."} Blank choices are not treated as the current state.`
                  : "Current controls came from an earlier client overview and may have changed."}
              </span>
              {typeof onRefresh === "function" && (
                <button
                  type="button"
                  className="ghost compact"
                  data-capability-action="refresh-customer-email-controls"
                  onClick={() => onRefresh()}
                >
                  Refresh client overview
                </button>
              )}
            </div>
          )}
          <label>
            Recorded email consent
            <select
              value={form.consentState}
              disabled={formLocked}
              data-capability-field="customer-email-consent"
              onChange={(event) => {
                const consentStateValue = event.target.value;
                updateForm({
                  consentState: consentStateValue,
                  ...(consentStateValue === "revoked" ? { subscriptionState: "unsubscribed" } : {})
                });
              }}
            >
              <option value="">Choose documented consent</option>
              <option value="granted">Consent granted</option>
              <option value="revoked">Consent revoked</option>
            </select>
          </label>
          <label>
            Reminder subscription
            <select
              value={form.subscriptionState}
              disabled={formLocked}
              data-capability-field="customer-email-subscription"
              onChange={(event) => updateForm({ subscriptionState: event.target.value })}
            >
              <option value="">Choose subscription state</option>
              <option value="subscribed" disabled={form.consentState !== "granted"}>Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
          </label>
          <label className="workflow-check-row">
            <input
              type="checkbox"
              checked={form.evidenceConfirmed}
              disabled={formLocked || !selectionValid}
              data-capability-field="customer-email-evidence-confirmed"
              onChange={(event) => updateForm({ evidenceConfirmed: event.target.checked })}
            />
            I reviewed customer-specific source evidence for these exact email-channel states.
          </label>
          <div className="workspace-inline-actions">
            <button
              type="button"
              className="cta"
              disabled={!canSubmit}
              data-capability-action="save-customer-email-controls"
              onClick={submitControls}
            >
              {mutation.state === "error" && !mutation.pending ? "Retry control save" : "Save email controls"}
            </button>
            {view.canReconcile && (
              <button
                type="button"
                className="ghost compact"
                data-capability-action="reconcile-customer-email-controls"
                onClick={reconcileControls}
              >
                Reconcile unchanged request
              </button>
            )}
            {view.canReset && (
              <button
                type="button"
                className="ghost compact"
                data-capability-action="reset-customer-email-controls"
                onClick={resetRejectedAttempt}
              >
                Reset rejected attempt
              </button>
            )}
          </div>
        </div>
      )}

      {text(mutation.error) && (
        <p className="warning-note" role="alert">{text(mutation.error)}</p>
      )}
      {mutation.state === "receipt" && mutation.receipt && (
        <p className="source-note" data-customer-email-controls-receipt>
          Exact server receipt recorded {formatWorkspaceDateTime(mutation.receipt.recordedAtISO)}. This receipt proves only the control mutation.
        </p>
      )}
    </section>
  );
}
