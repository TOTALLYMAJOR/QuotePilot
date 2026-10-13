import PropTypes from "prop-types";

export function resolveEmailAcceptanceCapabilityState({
  configured = false,
  testing = false,
  reconciling = false,
  recovering = false,
  result = null,
  error = "",
  uncertain = false
} = {}) {
  if (reconciling) return "reconciliation";
  if (testing) return "submitting";
  if (result?.state === "provider_accepted") return "receipt";
  if (uncertain) return "uncertain";
  if (recovering) return "recovery";
  if (error) return "error";
  return configured ? "ready" : "unavailable";
}

export default function EmailProviderAcceptancePanel({
  emailStatus = {},
  recipientEmail = "",
  confirmationToken = "",
  expectedConfirmationToken = "",
  testing = false,
  reconciling = false,
  recovering = false,
  result = null,
  error = "",
  uncertain = false,
  onRecipientChange = () => {},
  onConfirmationChange = () => {},
  onSend = () => {},
  onReview = () => {}
}) {
  const configured = emailStatus?.configured === true
    && String(emailStatus?.provider || "").trim().toLowerCase() === "resend";
  const state = resolveEmailAcceptanceCapabilityState({
    configured,
    testing,
    reconciling,
    recovering,
    result,
    error,
    uncertain
  });
  const locked = testing || reconciling || uncertain || result?.state === "provider_accepted";
  const validRecipient = /^[^@\s]+@quietpilot\.us$/i.test(recipientEmail.trim());
  const confirmationMatches = Boolean(expectedConfirmationToken)
    && confirmationToken === expectedConfirmationToken;
  const canSend = configured && validRecipient && confirmationMatches && !locked;

  return (
    <section
      className="admin-section"
      data-capability-id="resend-provider-acceptance-test"
      data-capability-state={state}
    >
      <div className="admin-section-head">
        <div>
          <h3>Email provider acceptance test</h3>
          <p className="source-note">
            Send one server-controlled message to a controlled quietpilot.us inbox. This tests the
            production Resend path without customer or quote data.
          </p>
        </div>
      </div>

      <div className="status-strip" aria-label="Email provider setup status">
        <span>Provider: <strong>{emailStatus?.provider || "none"}</strong></span>
        <span>Approved sender: <strong>{configured ? "configured" : "not configured"}</strong></span>
        <span>Sender: <strong>{emailStatus?.fromEmailHint || "not reported"}</strong></span>
      </div>

      <p className="source-note">
        Provider acceptance proves only that Resend accepted the request. Delivery still requires a
        Resend delivered event and recipient inbox confirmation.
      </p>

      <div className="admin-grid-settings integration-form-grid">
        <label>
          Controlled recipient
          <input
            type="email"
            value={recipientEmail}
            onChange={(event) => onRecipientChange(event.target.value)}
            placeholder="operator@quietpilot.us"
            autoComplete="off"
            disabled={locked}
          />
        </label>
        <label>
          Exact confirmation
          <input
            type="text"
            value={confirmationToken}
            onChange={(event) => onConfirmationChange(event.target.value)}
            placeholder={expectedConfirmationToken || "Enter a controlled recipient first"}
            autoComplete="off"
            disabled={locked}
          />
        </label>
      </div>

      {expectedConfirmationToken && !result && (
        <p className="source-note">Type exactly: <strong>{expectedConfirmationToken}</strong></p>
      )}
      {!configured && (
        <p className="warning-note">The approved production Resend sender is not configured.</p>
      )}
      {error && (
        <p className={uncertain ? "warning-note" : "error-note"} role="alert">{error}</p>
      )}

      {result?.state === "provider_accepted" && (
        <div className="status-strip" aria-live="polite">
          <span>State: <strong>provider accepted</strong></span>
          <span>Recipient: <strong>{result.recipientEmail}</strong></span>
          <span>Accepted: <strong>{result.acceptedAtISO}</strong></span>
          <span>Provider message ID: <strong>{result.providerMessageId}</strong></span>
        </div>
      )}

      <div className="right-actions">
        {uncertain && (
          <button
            type="button"
            className="ghost"
            data-capability-action="review-resend-acceptance-receipt"
            onClick={onReview}
            disabled={reconciling}
          >
            {reconciling ? "Reviewing record..." : "Review durable record"}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          data-capability-action="send-resend-acceptance-test"
          onClick={onSend}
          disabled={!canSend}
        >
          {testing
            ? "Sending once..."
            : result
              ? "Provider accepted"
              : recovering
                ? "Try fresh controlled test"
                : "Send controlled test"}
        </button>
      </div>
    </section>
  );
}

EmailProviderAcceptancePanel.propTypes = {
  emailStatus: PropTypes.object,
  recipientEmail: PropTypes.string,
  confirmationToken: PropTypes.string,
  expectedConfirmationToken: PropTypes.string,
  testing: PropTypes.bool,
  reconciling: PropTypes.bool,
  recovering: PropTypes.bool,
  result: PropTypes.object,
  error: PropTypes.string,
  uncertain: PropTypes.bool,
  onRecipientChange: PropTypes.func,
  onConfirmationChange: PropTypes.func,
  onSend: PropTypes.func,
  onReview: PropTypes.func
};
