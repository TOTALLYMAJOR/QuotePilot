import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const COMMERCE_OPS_SOURCE = fs.readFileSync(
  new URL("../commerceOps.js", import.meta.url),
  "utf8"
);

function exportedFunctionSource(name) {
  const marker = `exports.${name} =`;
  const start = FUNCTIONS_SOURCE.indexOf(marker);
  if (start < 0) throw new Error(`Missing exported Function ${name}.`);
  const next = FUNCTIONS_SOURCE.indexOf("\nexports.", start + marker.length);
  return FUNCTIONS_SOURCE.slice(start, next < 0 ? FUNCTIONS_SOURCE.length : next);
}

describe("owner SMS provider integration boundaries", () => {
  test("keeps provider choice explicit and reserves quote plus Stripe alerts through the durable outbox", () => {
    expect(FUNCTIONS_SOURCE).toContain(
      'const SMS_PROVIDERS = new Set(["pingram", "twilio", "none"]);'
    );

    const quoteAlert = exportedFunctionSource("notifyOwnerNewQuote");
    expect(quoteAlert).toContain("persistOwnerSmsOutbox({");
    expect(quoteAlert).toContain("ownerSmsOutboxPublicProjection(smsOutbox)");
    expect(quoteAlert).not.toContain(".runWith({");
    expect(quoteAlert).not.toContain("TWILIO_AUTH_TOKEN_SECRET_NAME");
    expect(quoteAlert).not.toContain("PINGRAM_API_KEY_SECRET_NAME");

    const stripeWebhook = exportedFunctionSource("stripeWebhook");
    expect(stripeWebhook).toContain(
      ".runWith({ secrets: [STRIPE_WEBHOOK_SECRET_NAME] })"
    );
    expect(stripeWebhook).toContain("buildOwnerSmsOutboxCommand({");
    expect(stripeWebhook).toContain("ownerSmsOutboxCommand:");
    expect(stripeWebhook).not.toContain("TWILIO_AUTH_TOKEN_SECRET_NAME");
    expect(stripeWebhook).not.toContain("PINGRAM_API_KEY_SECRET_NAME");
    expect(stripeWebhook).not.toContain("PINGRAM_WEBHOOK_SECRET_NAME");
    expect(stripeWebhook).not.toContain("SMS_CONTACT_DIGEST_SECRET_NAME");
    expect(FUNCTIONS_SOURCE).toContain("async function claimOwnerSmsOutbox");
    expect(FUNCTIONS_SOURCE).toContain("function ownerSmsOutboxPublicProjection");
    expect(FUNCTIONS_SOURCE).toContain("reused: outbox.created === false");
    expect(FUNCTIONS_SOURCE).toContain('state: "reserving"');
    expect(FUNCTIONS_SOURCE).toContain("async function recoverStaleOwnerSmsOutboxReservation");
    expect(FUNCTIONS_SOURCE).toContain('normalizeText(current.state).toLowerCase() !== "reserving"');
  });

  test("isolates each provider worker and the Pingram ingress to its exact secrets", () => {
    const pingramWorker = exportedFunctionSource("dispatchPingramOwnerSms");
    expect(pingramWorker).toContain("PINGRAM_API_KEY_SECRET_NAME");
    expect(pingramWorker).toContain("SMS_CONTACT_DIGEST_SECRET_NAME");
    expect(pingramWorker).toContain("failurePolicy: true");
    expect(pingramWorker).not.toContain("PINGRAM_WEBHOOK_SECRET_NAME");
    expect(pingramWorker).not.toContain("TWILIO_AUTH_TOKEN_SECRET_NAME");
    expect(pingramWorker).not.toContain("STRIPE_SECRET_NAME");
    expect(pingramWorker).not.toContain("RESEND_API_KEY_SECRET_NAME");

    const twilioWorker = exportedFunctionSource("dispatchTwilioOwnerSms");
    expect(twilioWorker).toContain("TWILIO_AUTH_TOKEN_SECRET_NAME");
    expect(twilioWorker).toContain("SMS_CONTACT_DIGEST_SECRET_NAME");
    expect(twilioWorker).toContain("failurePolicy: true");
    expect(twilioWorker).not.toContain("PINGRAM_API_KEY_SECRET_NAME");
    expect(twilioWorker).not.toContain("PINGRAM_WEBHOOK_SECRET_NAME");

    const pingramWebhook = exportedFunctionSource("pingramSmsWebhook");
    expect(pingramWebhook).toContain(
      ".runWith({ secrets: [PINGRAM_WEBHOOK_SECRET_NAME] })"
    );
    expect(pingramWebhook).toContain("rawBody: req.rawBody");
    expect(pingramWebhook).toContain("verifyPingramSmsWebhook({");
    expect(pingramWebhook).toContain("isPingramWebhookSecretShape(webhookSecret)");
    expect(pingramWebhook).toContain('res.status(500).send("Pingram webhook is temporarily unavailable.")');
    expect(pingramWebhook).toContain("payloadDigest:");
    expect(pingramWebhook).not.toContain("PINGRAM_API_KEY_SECRET_NAME");
    expect(pingramWebhook).not.toContain("SMS_CONTACT_DIGEST_SECRET_NAME");
    expect(pingramWebhook).not.toContain("messageBody:");

    const statusCallable = exportedFunctionSource("getIntegrationSetupStatus");
    expect(statusCallable).not.toContain("PINGRAM_API_KEY_SECRET_NAME");
    expect(statusCallable).not.toContain("PINGRAM_WEBHOOK_SECRET_NAME");
    expect(statusCallable).not.toContain("SMS_CONTACT_DIGEST_SECRET_NAME");
    expect(FUNCTIONS_SOURCE).not.toContain("twilioConfig.authToken");
    expect(FUNCTIONS_SOURCE).toContain("credentialsConfigured: null");
    expect(FUNCTIONS_SOURCE).toContain("localConfigComplete: selectedSmsLocalConfigComplete");
    expect(FUNCTIONS_SOURCE).toContain("canAttemptDiagnostic:");
    expect(FUNCTIONS_SOURCE).not.toContain("canRunDiagnostic:");
    expect(FUNCTIONS_SOURCE).toContain("canSend: null");
  });

  test("uses a durable exact request identity and does not bind provider secrets to the test callable", () => {
    const testCallable = exportedFunctionSource("sendIntegrationTestSms");
    expect(testCallable).toContain("/^sms_test_[a-f0-9]{32}$/");
    expect(testCallable).toContain("enforceTestRateLimit: true");
    expect(testCallable).toContain("queueOwnerSmsAttempt({");
    expect(testCallable).not.toContain(".runWith({");
    expect(testCallable).not.toContain("_SECRET_NAME");

    expect(COMMERCE_OPS_SOURCE).toContain("export function createSmsTestRequestId");
    expect(COMMERCE_OPS_SOURCE).toContain("requestId: normalizedRequestId");
    expect(COMMERCE_OPS_SOURCE).toContain("sms_test_${uuid}");
  });

  test("removes the frozen body, recovers a claimed retry without resending, and durably reprocesses early webhooks", () => {
    const finalizeStart = FUNCTIONS_SOURCE.indexOf("async function finalizeOwnerSmsDispatch");
    const finalizeEnd = FUNCTIONS_SOURCE.indexOf("async function dispatchOwnerSmsAttempt", finalizeStart);
    const finalizeSource = FUNCTIONS_SOURCE.slice(finalizeStart, finalizeEnd);
    expect(finalizeSource).toContain("messageBody: FieldValue.delete()");
    expect(finalizeSource).toContain("OWNER_SMS_ATTEMPT_STATES.UNCERTAIN");

    const dispatchStart = FUNCTIONS_SOURCE.indexOf("async function dispatchOwnerSmsAttempt");
    const dispatchEnd = FUNCTIONS_SOURCE.indexOf("function pingramWebhookReceiptId", dispatchStart);
    const dispatchSource = FUNCTIONS_SOURCE.slice(dispatchStart, dispatchEnd);
    expect(dispatchSource).toContain("claim.kind === \"recover_dispatching\"");
    expect(dispatchSource).toContain("Another invocation owns the persisted dispatch lease");
    expect(dispatchSource).toContain("return currentAttempt;");
    expect(dispatchSource).toContain("return claim.attempt;");
    expect(dispatchSource).not.toContain("dispatch_completion_unavailable");
    expect(dispatchSource).toContain("await send({ attempt: claim.attempt, config: workerConfig })");
    expect(dispatchSource).not.toContain("for (");
    expect(dispatchSource).not.toContain("while (");
    expect(dispatchSource).not.toContain("setTimeout");

    const receiptWorker = exportedFunctionSource("processPingramSmsWebhookReceipt");
    expect(receiptWorker).toContain("failurePolicy: true");
    expect(receiptWorker).toContain("processPingramSmsWebhookReceiptRef");
    const bindingWorker = exportedFunctionSource("reconcilePingramSmsProviderBinding");
    expect(bindingWorker).toContain("failurePolicy: true");
    expect(bindingWorker).toContain("reconcilePingramReceiptsForTrackingId");
    expect(FUNCTIONS_SOURCE).toContain('state: "pending_binding"');
    expect(FUNCTIONS_SOURCE).toContain('state: "processed_opt_out_hold"');
    expect(FUNCTIONS_SOURCE).toContain('safeReason: "signed_provider_opt_out_signal"');
    expect(FUNCTIONS_SOURCE).toContain('ownerSmsDocumentHash("channel-suppression", "owner-sms")');
    expect(FUNCTIONS_SOURCE).toContain('provider: "all"');
    expect(FUNCTIONS_SOURCE).toContain('signalProvider: "pingram"');
    const webhookIngress = exportedFunctionSource("pingramSmsWebhook");
    expect(webhookIngress).toContain('ownerSmsProviderSuppressionRef("pingram")');
    expect(webhookIngress).toContain("persistSuppression();");
    expect(webhookIngress).toContain("pingramCounterpartReceiptRef");
    expect(webhookIngress).toContain("conflictingTerminalEvent");
    expect(webhookIngress).toContain('state: "requires_review_conflicting_events"');
    expect(FUNCTIONS_SOURCE).toContain('safeReason: "conflicting_terminal_provider_events"');
    expect(FUNCTIONS_SOURCE).toContain("conflictingWebhookReceiptId: receiptRef.id");
  });

  test("locks one unresolved diagnostic server-side and requires signed delivery readiness for automatic Pingram alerts", () => {
    expect(FUNCTIONS_SOURCE).toContain("ownerSmsTestLockRef");
    expect(FUNCTIONS_SOURCE).toContain("An SMS diagnostic is still unresolved");
    expect(FUNCTIONS_SOURCE).toContain("provider_readiness_unproven");
    expect(FUNCTIONS_SOURCE).toContain("signedDeliveryReceiptId");
    expect(FUNCTIONS_SOURCE).toContain("PINGRAM_CONFIGURATION_GENERATION");
  });
});
