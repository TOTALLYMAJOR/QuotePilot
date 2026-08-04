"use strict";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function webhookConfigurationError() {
  const error = new Error("Stripe webhook signing-secret configuration is invalid.");
  error.code = "webhook_secret_configuration_invalid";
  return error;
}

function normalizeStripeWebhookSecrets(value) {
  const secrets = text(value)
    .split(",")
    .map((item) => text(item))
    .filter(Boolean);
  if (
    !secrets.length
    || secrets.length > 2
    || new Set(secrets).size !== secrets.length
    || secrets.some((secret) => !/^whsec_[A-Za-z0-9_=-]{8,255}$/.test(secret))
  ) {
    throw webhookConfigurationError();
  }
  return secrets;
}

function constructStripeWebhookEvent({
  rawBody,
  signature,
  webhookSecret,
  webhooks
} = {}) {
  if (!webhooks || typeof webhooks.constructEvent !== "function") {
    throw webhookConfigurationError();
  }
  const secrets = normalizeStripeWebhookSecrets(webhookSecret);
  for (const secret of secrets) {
    try {
      return webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      // Rotation overlap intentionally tries the next configured signing secret.
    }
  }
  const error = new Error("Stripe webhook signature verification failed.");
  error.code = "signature_verification_failed";
  throw error;
}

module.exports = {
  constructStripeWebhookEvent,
  normalizeStripeWebhookSecrets
};
