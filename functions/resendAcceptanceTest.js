const RESEND_ACCEPTANCE_SCHEMA_VERSION = 1;
const RESEND_ACCEPTANCE_REQUEST_PATTERN = /^email_test_[a-f0-9]{32}$/;
const RESEND_ACCEPTANCE_RECIPIENT_DOMAIN = "quietpilot.us";
const RESEND_ACCEPTANCE_STATES = Object.freeze({
  DISPATCHING: "dispatching",
  PROVIDER_ACCEPTED: "provider_accepted",
  DEFINITE_FAILURE: "definite_failure",
  OUTCOME_UNKNOWN: "outcome_unknown"
});

class ResendAcceptanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResendAcceptanceError";
    this.code = code;
  }
}

function text(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return text(value, 254).toLowerCase();
}

function buildResendAcceptanceConfirmationToken(recipientEmail = "") {
  const recipient = normalizeEmail(recipientEmail);
  return recipient ? `SEND RESEND TEST TO ${recipient}` : "";
}

function normalizeResendAcceptanceRequest(input = {}) {
  const supplied = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const unexpectedKeys = Object.keys(supplied).filter(
    (key) => !["requestId", "recipientEmail", "confirmationToken"].includes(key)
  );
  if (unexpectedKeys.length) {
    throw new ResendAcceptanceError(
      "invalid-argument",
      "Email acceptance test request contains unsupported fields."
    );
  }
  const requestId = text(supplied.requestId, 80).toLowerCase();
  if (!RESEND_ACCEPTANCE_REQUEST_PATTERN.test(requestId)) {
    throw new ResendAcceptanceError(
      "invalid-argument",
      "A valid email acceptance test request ID is required."
    );
  }
  const recipientEmail = normalizeEmail(supplied.recipientEmail);
  const emailParts = recipientEmail.split("@");
  if (
    emailParts.length !== 2
    || !emailParts[0]
    || emailParts[1] !== RESEND_ACCEPTANCE_RECIPIENT_DOMAIN
    || !/^[^@\s]+@quietpilot\.us$/.test(recipientEmail)
  ) {
    throw new ResendAcceptanceError(
      "invalid-argument",
      `The acceptance recipient must be a controlled ${RESEND_ACCEPTANCE_RECIPIENT_DOMAIN} address.`
    );
  }
  const expectedConfirmation = buildResendAcceptanceConfirmationToken(recipientEmail);
  if (text(supplied.confirmationToken, 320) !== expectedConfirmation) {
    throw new ResendAcceptanceError(
      "invalid-argument",
      `Confirmation mismatch. Use exactly: ${expectedConfirmation}`
    );
  }
  return { requestId, recipientEmail, confirmationToken: expectedConfirmation };
}

function buildResendAcceptancePayload({
  requestId,
  recipientEmail,
  actorEmail,
  requestedAtISO
} = {}) {
  const timestamp = new Date(requestedAtISO || "");
  if (Number.isNaN(timestamp.getTime())) {
    throw new ResendAcceptanceError("invalid-argument", "A valid request timestamp is required.");
  }
  const normalizedActor = normalizeEmail(actorEmail);
  const normalizedRecipient = normalizeEmail(recipientEmail);
  const normalizedRequestId = text(requestId, 80).toLowerCase();
  if (!RESEND_ACCEPTANCE_REQUEST_PATTERN.test(normalizedRequestId) || !normalizedActor) {
    throw new ResendAcceptanceError("invalid-argument", "Acceptance test identity is incomplete.");
  }
  const canonicalTimestamp = timestamp.toISOString();
  const subject = "QuotePilot Resend acceptance test";
  const lines = [
    "This is a controlled QuotePilot production email-provider acceptance test.",
    "",
    `Requested by: ${normalizedActor}`,
    `Requested at: ${canonicalTimestamp}`,
    `Request ID: ${normalizedRequestId}`,
    "",
    "Receiving this message is inbox evidence. Provider acceptance alone does not prove delivery."
  ];
  return {
    toEmail: normalizedRecipient,
    subject,
    text: lines.join("\n"),
    html: ""
  };
}

function projectResendAcceptanceReceipt(record = {}, { idempotent = false } = {}) {
  const state = text(record.state, 40).toLowerCase();
  const requestId = text(record.requestId, 80).toLowerCase();
  const recipientEmail = normalizeEmail(record.recipientEmail);
  const providerMessageId = text(record.providerMessageId, 256);
  const acceptedAtISO = text(record.acceptedAtISO, 40);
  if (
    record.schemaVersion !== RESEND_ACCEPTANCE_SCHEMA_VERSION
    || state !== RESEND_ACCEPTANCE_STATES.PROVIDER_ACCEPTED
    || !RESEND_ACCEPTANCE_REQUEST_PATTERN.test(requestId)
    || !recipientEmail
    || !providerMessageId
    || !acceptedAtISO
  ) {
    throw new ResendAcceptanceError(
      "failed-precondition",
      "The stored email acceptance receipt is incomplete."
    );
  }
  return {
    ok: true,
    requestId,
    recipientEmail,
    state,
    provider: "resend",
    providerMessageId,
    acceptedAtISO,
    idempotent: idempotent === true
  };
}

function classifyResendAcceptanceFailure(error = {}) {
  const outcome = text(error?.quoteDeliveryOutcome, 40).toLowerCase();
  const status = Number(error?.providerHttpStatus || 0);
  const outcomeUnknown = outcome === "ambiguous" || !status || status >= 500;
  return {
    state: outcomeUnknown
      ? RESEND_ACCEPTANCE_STATES.OUTCOME_UNKNOWN
      : RESEND_ACCEPTANCE_STATES.DEFINITE_FAILURE,
    safeReason: outcomeUnknown ? "provider_outcome_unknown" : `provider_http_${status}`,
    retrySafe: !outcomeUnknown
  };
}

module.exports = {
  RESEND_ACCEPTANCE_SCHEMA_VERSION,
  RESEND_ACCEPTANCE_REQUEST_PATTERN,
  RESEND_ACCEPTANCE_RECIPIENT_DOMAIN,
  RESEND_ACCEPTANCE_STATES,
  ResendAcceptanceError,
  buildResendAcceptanceConfirmationToken,
  buildResendAcceptancePayload,
  classifyResendAcceptanceFailure,
  normalizeResendAcceptanceRequest,
  projectResendAcceptanceReceipt
};
