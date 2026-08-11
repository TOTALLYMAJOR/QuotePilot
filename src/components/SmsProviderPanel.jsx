import StatusChip from "./StatusChip";

const MUTATION_STATES = new Set([
  "ready",
  "submitting",
  "uncertain",
  "reconciliation",
  "receipt",
  "error",
  "recovery"
]);

const LOCKED_MUTATION_STATES = new Set([
  "submitting",
  "uncertain",
  "reconciliation"
]);

const RESULT_STATE_ALIASES = Object.freeze({
  queued: "submitting",
  dispatching: "submitting",
  accepted: "receipt",
  provider_accepted: "receipt",
  request_accepted: "receipt",
  delivered: "receipt",
  sent: "receipt",
  success: "receipt",
  ambiguous: "uncertain",
  indeterminate: "uncertain",
  outcome_ambiguous: "uncertain",
  outcome_unknown: "uncertain",
  unknown: "uncertain",
  failed: "error",
  rejected: "error",
  definite_failure: "error",
  reset: "recovery",
  recovered: "recovery"
});

const MUTATION_PRESENTATION = Object.freeze({
  ready: Object.freeze({ family: "info", label: "Ready for an exact test" }),
  submitting: Object.freeze({ family: "pending", label: "Waiting for a receipt" }),
  uncertain: Object.freeze({ family: "blocked", label: "Outcome indeterminate" }),
  reconciliation: Object.freeze({ family: "pending", label: "Reconciling original request" }),
  receipt: Object.freeze({ family: "provider", label: "Request accepted" }),
  error: Object.freeze({ family: "failed", label: "Request rejected" }),
  recovery: Object.freeze({ family: "action", label: "Recovery in progress" })
});

const MUTATION_COPY = Object.freeze({
  ready: "No SMS test request is currently in flight.",
  submitting: "Waiting for the server receipt for this exact SMS test request. Do not repeat it.",
  uncertain: "The send outcome is indeterminate and is not assumed complete. It is unsafe to retry; reconcile the original request first.",
  reconciliation: "Reloading server-owned attempt and signed-webhook evidence for the original request. This does not query the provider or create a second SMS send.",
  receipt: "The provider accepted the request. This receipt does not establish carrier delivery or recipient receipt.",
  error: "The request was definitively rejected before provider acceptance. No carrier delivery or recipient receipt is assumed.",
  recovery: "SMS status recovery is in progress. Review current server evidence before starting a new request."
});

const ERROR_PRESENTATION = Object.freeze({
  delivery_failure: Object.freeze({ family: "failed", label: "Delivery failed" }),
  definite_rejection: MUTATION_PRESENTATION.error,
  status_unavailable: Object.freeze({ family: "failed", label: "Status unavailable" })
});

const ERROR_COPY = Object.freeze({
  delivery_failure: "The provider accepted the request, but signed provider evidence reports delivery failure. Recipient receipt is not established.",
  definite_rejection: "The request was definitively rejected before provider acceptance. No carrier delivery or recipient receipt is assumed.",
  status_unavailable: "The current SMS status could not be loaded. No configuration, provider acceptance, or delivery outcome is inferred."
});

const SIGNED_DELIVERY_PRESENTATION = Object.freeze({
  family: "confirmed",
  label: "Signed delivery evidenced"
});

const SIGNED_DELIVERY_COPY = "Verified signed provider evidence establishes carrier delivery for the original SMS request. Recipient/device receipt is not established.";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function token(value) {
  return text(value, 64).toLowerCase().replace(/[\s-]+/g, "_");
}

function firstBoolean(...values) {
  return values.find((value) => typeof value === "boolean");
}

function resultRecord(value) {
  if (!isRecord(value)) return {};
  return isRecord(value.sms) ? value.sms : value;
}

function evidenceRecord(status, smsResult) {
  const direct = resultRecord(smsResult);
  if (Object.keys(direct).length > 0) return direct;
  return resultRecord(status?.sms?.latestEvidence);
}

function errorOutcome(status, smsResult, statusError) {
  const evidence = evidenceRecord(status, smsResult);
  const state = token(evidence.state || evidence.outcome);
  if (state === "failed") return "delivery_failure";
  if (
    state === "definite_failure"
    || state === "rejected"
    || evidence.definitive === true
  ) {
    return "definite_rejection";
  }
  return text(statusError?.message || statusError)
    ? "status_unavailable"
    : "definite_rejection";
}

function explicitMutationState(status, smsResult) {
  const smsStatus = isRecord(status?.sms) ? status.sms : {};
  const result = resultRecord(smsResult);
  const supplied = [
    result.capabilityState,
    result.mutationState,
    result.state,
    result.outcome,
    smsStatus.mutationState
  ];
  for (const value of supplied) {
    const candidate = token(value);
    if (MUTATION_STATES.has(candidate)) return candidate;
    if (RESULT_STATE_ALIASES[candidate]) return RESULT_STATE_ALIASES[candidate];
  }
  if (
    result.indeterminate === true
    || result.ambiguous === true
    || result.requiresReconciliation === true
  ) {
    return "uncertain";
  }
  if (result.accepted === true || result.sent === true || result.ok === true) return "receipt";
  if (result.definitive === true && (result.error || result.ok === false)) return "error";
  if (result.safeToRetry === false) return "uncertain";
  return "";
}

export function resolveSmsProviderCapabilityState({
  status = null,
  loading = false,
  testing = false,
  reconciling = false,
  statusError = "",
  smsResult = null
} = {}) {
  if (reconciling) return "reconciliation";
  if (testing) return "submitting";
  const explicit = explicitMutationState(status, smsResult);
  if (explicit) return explicit;
  if (text(statusError?.message || statusError)) return loading ? "recovery" : "error";
  return "ready";
}

export function isSmsProviderAttemptLocked(options = {}) {
  const evidenceState = token(evidenceRecord(options.status, options.smsResult).state);
  return LOCKED_MUTATION_STATES.has(resolveSmsProviderCapabilityState(options))
    || ["queued", "dispatching", "provider_accepted"].includes(evidenceState);
}

function providerId(value) {
  const candidate = token(value);
  if (candidate === "pingram" || candidate === "twilio" || candidate === "none") return candidate;
  return "unsupported";
}

function providerLabel(value) {
  return {
    pingram: "Pingram",
    twilio: "Twilio",
    none: "None",
    unsupported: "Unsupported"
  }[providerId(value)];
}

function readiness(value, trueLabel = "configured", falseLabel = "not configured") {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return "not reported";
}

function missingFieldLabel(provider) {
  if (!Array.isArray(provider?.missingFields)) return "not reported";
  const count = provider.missingFields.filter((value) => text(value)).length;
  return count === 0 ? "complete" : `${count} required field${count === 1 ? "" : "s"} missing`;
}

function redactGuidance(value) {
  const sensitiveKey = /(API_KEY|AUTH_TOKEN|SECRET|PASSWORD|PHONE|FROM_NUMBER|ACCOUNT_SID|SERVICE_SID)/i;
  return text(value, 12_000)
    .split(/\r?\n/)
    .map((line) => {
      const assignment = line.match(/^(\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*)(.*)$/);
      if (!assignment || !sensitiveKey.test(assignment[2]) || !text(assignment[3])) return line;
      return `${assignment[1]}<stored in trusted runtime>`;
    })
    .join("\n")
    .replace(/(--(?:token|secret|api-key|auth-token)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1<stored in trusted runtime>")
    .replace(/\+\d[\d().\s-]{7,}\d/g, "[phone hidden]");
}

function configurationValue(provider, keys, fallback) {
  const values = keys.map((key) => provider?.[key]);
  return firstBoolean(...values, fallback);
}

export default function SmsProviderPanel({
  status = null,
  loading = false,
  testing = false,
  reconciling = false,
  statusError = "",
  smsResult = null,
  testMessage = "",
  onRefresh,
  onTestMessageChange,
  onSendTest,
  onCopySetupGuidance,
  onCopyDisableGuidance,
  setupGuidance = "",
  disableGuidance = "",
  pingramGuidance = "Pingram requires a trusted runtime API credential and sender identity. Delivery truth remains unavailable until signed webhook evidence is reconciled.",
  twilioGuidance = "Twilio requires trusted runtime auth and contact-digest secrets, a Messaging Service, and an approved sender. Configuration alone does not establish carrier delivery."
}) {
  const safeStatus = isRecord(status) ? status : {};
  const smsStatus = isRecord(safeStatus.sms) ? safeStatus.sms : {};
  const pingram = isRecord(safeStatus.pingram) ? safeStatus.pingram : {};
  const twilio = isRecord(safeStatus.twilio) ? safeStatus.twilio : {};
  const selectedProvider = providerId(smsStatus.provider ?? safeStatus.smsProvider);
  const selectedConfiguration = selectedProvider === "pingram"
    ? pingram
    : selectedProvider === "twilio" ? twilio : {};
  const providerSupported = firstBoolean(
    smsStatus.supported,
    safeStatus.smsProviderSupported
  );
  const localConfigComplete = firstBoolean(
    smsStatus.localConfigComplete,
    selectedConfiguration.localConfigComplete,
    selectedConfiguration.locallyConfigured,
    selectedConfiguration.configured
  );
  const canAttemptDiagnostic = smsStatus.canAttemptDiagnostic === true
    || selectedConfiguration.canAttemptDiagnostic === true;
  const channelSuppressed = firstBoolean(
    smsStatus.suppressed,
    pingram.suppressed,
    twilio.suppressed
  );
  const capabilityState = resolveSmsProviderCapabilityState({
    status: safeStatus,
    loading,
    testing,
    reconciling,
    statusError,
    smsResult
  });
  const attemptLocked = isSmsProviderAttemptLocked({
    status: safeStatus,
    loading,
    testing,
    reconciling,
    statusError,
    smsResult
  });
  const controlsBusy = loading || testing || reconciling;
  const sendDisabled = !canAttemptDiagnostic
    || controlsBusy
    || attemptLocked
    || Boolean(text(statusError?.message || statusError));
  const errorKind = errorOutcome(safeStatus, smsResult, statusError);
  const currentEvidence = evidenceRecord(safeStatus, smsResult);
  const evidenceState = token(currentEvidence.state);
  const signedDeliveryEvidenced = capabilityState === "receipt" && evidenceState === "delivered";
  const capabilityPresentation = signedDeliveryEvidenced
    ? SIGNED_DELIVERY_PRESENTATION
    : capabilityState === "error"
      ? ERROR_PRESENTATION[errorKind]
      : MUTATION_PRESENTATION[capabilityState];
  const capabilityCopy = signedDeliveryEvidenced
    ? SIGNED_DELIVERY_COPY
    : capabilityState === "error"
      ? ERROR_COPY[errorKind]
      : MUTATION_COPY[capabilityState];
  const setupText = redactGuidance(setupGuidance);
  const disableText = redactGuidance(disableGuidance);
  const pingramCredential = configurationValue(
    pingram,
    ["apiKeyConfigured", "credentialConfigured", "credentialsConfigured"]
  );
  const pingramSender = configurationValue(
    pingram,
    ["senderConfigured", "fromNumberConfigured", "senderIdentityConfigured"]
  );
  const pingramWebhook = configurationValue(
    pingram,
    ["webhookConfigured", "webhookSigningConfigured", "signedWebhookConfigured"]
  );
  const pingramReconciliation = configurationValue(
    pingram,
    ["reconciliationConfigured", "canReconcile", "deliveryTruthConfigured"]
  );
  const twilioCredential = configurationValue(
    twilio,
    ["credentialConfigured", "credentialsConfigured", "accountConfigured"]
  );
  const twilioService = configurationValue(
    twilio,
    ["messagingServiceConfigured", "serviceConfigured"]
  );
  const twilioRegistration = configurationValue(
    twilio,
    ["senderRegistered", "a2pApproved", "registrationApproved"]
  );
  const resultProvider = providerLabel(
    currentEvidence.provider ?? smsStatus.provider ?? safeStatus.smsProvider
  );

  return (
    <section
      className="admin-section"
      aria-labelledby="sms-provider-choice-title"
      aria-busy={controlsBusy}
      data-capability-id="sms-provider-choice"
      data-capability-state={capabilityState}
    >
      <div className="admin-section-head">
        <div>
          <p className="eyebrow">Admin-only provider controls</p>
          <h3 id="sms-provider-choice-title">SMS provider choice &amp; delivery evidence</h3>
        </div>
        <StatusChip {...capabilityPresentation} />
      </div>

      <p className="source-note">
        Integration Ops reports server-owned non-secret runtime fields and recorded evidence.
        Field completeness does not prove that credentials exist. Credentials, secret material,
        provider identifiers, and full phone numbers are never rendered in this browser panel.
      </p>

      <div className="status-strip" aria-label="SMS provider status">
        <span>Selected provider: <strong>{providerLabel(selectedProvider)}</strong></span>
        <span>Supported choice: <strong>{readiness(providerSupported, "yes", "no")}</strong></span>
        <span>Local runtime fields: <strong>{readiness(
          localConfigComplete,
          "complete",
          "incomplete"
        )}</strong></span>
        <span>Controlled diagnostic can be attempted: <strong>{
          canAttemptDiagnostic ? "yes" : "no"
        }</strong></span>
        <span>Owner SMS opt-out hold: <strong>{readiness(
          channelSuppressed,
          "active",
          "inactive"
        )}</strong></span>
        <span>Status refresh: <strong>{loading ? "in progress" : statusError ? "unavailable" : "current"}</strong></span>
      </div>

      <div className="dashboard-grid">
        <article className="metric-card" data-sms-provider="pingram" data-provider-selected={selectedProvider === "pingram"}>
          <span>Pingram</span>
          <strong>{selectedProvider === "pingram" ? "Selected" : "Available choice"}</strong>
          <small>API credential: {readiness(pingramCredential)}</small>
          <small>Sender identity: {readiness(pingramSender)}</small>
          <small>Signed webhook: {readiness(pingramWebhook)}</small>
          <small>Delivery reconciliation: {readiness(pingramReconciliation)}</small>
          <small>Automatic alerts: {readiness(pingram.automaticAlertsReady, "ready", "not ready")}</small>
          <small>Opt-out hold: {readiness(channelSuppressed, "active", "inactive")}</small>
          <small>Runtime fields: {missingFieldLabel(pingram)}</small>
          <small>{redactGuidance(pingramGuidance)}</small>
        </article>

        <article className="metric-card" data-sms-provider="twilio" data-provider-selected={selectedProvider === "twilio"}>
          <span>Twilio</span>
          <strong>{selectedProvider === "twilio" ? "Selected" : "Available choice"}</strong>
          <small>Account credentials: {readiness(twilioCredential)}</small>
          <small>Messaging Service: {readiness(twilioService)}</small>
          <small>Sender registration: {readiness(twilioRegistration, "confirmed", "not confirmed")}</small>
          <small>Opt-out hold: {readiness(channelSuppressed, "active", "inactive")}</small>
          <small>Runtime fields: {missingFieldLabel(twilio)}</small>
          <small>{redactGuidance(twilioGuidance)}</small>
        </article>
      </div>

      <p className="warning-note">
        Request acceptance is not carrier delivery. An indeterminate send is unsafe to retry;
        reconcile the original request instead. Pingram webhook and reconciliation are required
        for delivery truth.
      </p>

      {statusError && (
        <p className="error-note" role="alert">
          SMS provider status is unavailable. No configuration or delivery outcome is inferred.
        </p>
      )}
      {channelSuppressed === true && (
        <p className="warning-note" role="alert">
          Owner SMS is held across every provider selection. This indefinite v1 hold has no
          browser or callable clear path; operator review or renewed consent does not resume
          sending in this version.
        </p>
      )}
      <p
        className={capabilityState === "error" || capabilityState === "uncertain" ? "warning-note" : "source-note"}
        role={capabilityState === "error" || capabilityState === "uncertain" ? "alert" : "status"}
        aria-live="polite"
      >
        {capabilityCopy}
        {capabilityState === "receipt" ? ` Recorded provider: ${resultProvider}.` : ""}
      </p>

      <div className="admin-grid-settings integration-form-grid">
        <label className="integration-message-field">
          Test SMS message (optional)
          <input
            type="text"
            aria-label="Test SMS message (optional)"
            maxLength={320}
            autoComplete="off"
            placeholder="Connectivity test for provider setup"
            value={String(testMessage ?? "")}
            onChange={(event) => onTestMessageChange?.(event.target.value)}
            disabled={controlsBusy || attemptLocked}
          />
        </label>
      </div>

      {setupText && (
        <>
          <p className="source-note">Trusted runtime setup guidance (credential values omitted)</p>
          <pre className="integration-command-block"><code>{setupText}</code></pre>
        </>
      )}
      {disableText && (
        <>
          <p className="source-note">Safe disable guidance</p>
          <pre className="integration-command-block"><code>{disableText}</code></pre>
        </>
      )}

      <div className="right-actions">
        <button
          type="button"
          className="ghost"
          onClick={onRefresh}
          disabled={controlsBusy || typeof onRefresh !== "function"}
          data-capability-action="refresh-sms-provider-status"
        >
          {reconciling ? "Refreshing Evidence..." : loading ? "Refreshing..." : attemptLocked ? "Refresh Recorded Evidence" : "Refresh SMS Status"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onCopySetupGuidance}
          disabled={!setupText || typeof onCopySetupGuidance !== "function"}
          data-capability-action="copy-sms-provider-setup"
        >
          Copy Setup Guidance
        </button>
        <button
          type="button"
          className="ghost"
          onClick={onCopyDisableGuidance}
          disabled={!disableText || typeof onCopyDisableGuidance !== "function"}
          data-capability-action="copy-sms-provider-disable"
        >
          Copy SMS Disable Guidance
        </button>
        <button
          type="button"
          className="cta"
          onClick={onSendTest}
          disabled={sendDisabled || typeof onSendTest !== "function"}
          data-capability-action="send-sms-provider-test"
        >
          {testing ? "Sending Test..." : "Send Test SMS"}
        </button>
      </div>
    </section>
  );
}
