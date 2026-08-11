#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required for Owner SMS acceptance.");
}

const projectId = process.env.GCLOUD_PROJECT || "demo-owner-sms";
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.NOTIFICATIONS_SMS_PROVIDER = "pingram";
process.env.PINGRAM_API_ORIGIN = "https://api.pingram.io";
process.env.PINGRAM_FROM_NUMBER = "+13125550124";
process.env.PINGRAM_CONFIGURATION_GENERATION = "emulator-2026-08-11-01";
process.env.NOTIFICATIONS_OWNER_PHONE = "+13125550123";
process.env.NOTIFICATIONS_OWNER_SMS_CONSENT = "granted";
process.env.TWILIO_ACCOUNT_SID = "AC11111111111111111111111111111111";
process.env.TWILIO_MESSAGING_SERVICE_SID = "MG11111111111111111111111111111111";
process.env.PINGRAM_API_KEY = "";
process.env.PINGRAM_WEBHOOK_SECRET = "pingram_whsecret_emulator_0123456789abcdef";
process.env.SMS_CONTACT_DIGEST_SECRET = "";

const functionsRequire = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const runtime = functionsRequire("./index.js");
const {
  OWNER_SMS_ATTEMPT_STATES,
  buildOwnerSmsAttemptId,
  buildOwnerSmsAttemptReservation,
  buildOwnerSmsPayloadDigest,
  buildOwnerSmsWebhookReceiptId,
  planOwnerSmsDispatch,
  planOwnerSmsOutcome
} = functionsRequire("./ownerSmsAttempts.js");

const db = getFirestore();
const organizationId = "org-owner-sms-emulator";
const fingerprint = `osrf_${"a".repeat(64)}`;
const configurationDigest = "b".repeat(64);
const generation = process.env.PINGRAM_CONFIGURATION_GENERATION;
const webhookSecret = process.env.PINGRAM_WEBHOOK_SECRET;

function iso(offsetSeconds = 0) {
  return new Date(Date.UTC(2026, 7, 11, 15, 0, offsetSeconds)).toISOString();
}

function attemptIdentity(sourceId, notificationType = "integration_test") {
  return {
    source: notificationType === "integration_test" ? "integration" : "stripe",
    sourceId,
    organizationId,
    notificationType
  };
}

function queuedAttempt(sourceId, notificationType = "integration_test") {
  const identity = attemptIdentity(sourceId, notificationType);
  return {
    ...buildOwnerSmsAttemptReservation({
      ...identity,
      provider: "pingram",
      payloadDigest: buildOwnerSmsPayloadDigest({ fixture: sourceId }),
      nowISO: iso(0)
    }),
    messageBody: `Owner SMS emulator ${sourceId}`,
    actorUid: "emulator"
  };
}

function acceptedAttempt(sourceId, trackingId) {
  const claimed = {
    ...planOwnerSmsDispatch({
      attempt: queuedAttempt(sourceId),
      leaseId: `lease_${sourceId}`,
      recipientFingerprint: fingerprint,
      nowISO: iso(1)
    }),
    configurationGeneration: generation,
    providerConfigurationDigest: configurationDigest
  };
  return planOwnerSmsOutcome({
    attempt: claimed,
    outcome: OWNER_SMS_ATTEMPT_STATES.PROVIDER_ACCEPTED,
    providerTrackingId: trackingId,
    nowISO: iso(2)
  });
}

function outboxDocument(sourceId, messageBody) {
  const identity = attemptIdentity(sourceId, "deposit_paid");
  return {
    schemaVersion: 1,
    attemptId: buildOwnerSmsAttemptId(identity),
    ...identity,
    messageBody,
    messageDigest: createHash("sha256").update(messageBody, "utf8").digest("hex"),
    actorUid: "system",
    state: "pending",
    queuedAtISO: "",
    createdAtISO: iso(3)
  };
}

async function invokeSignedPingramWebhook(payload, {
  headerEventId = payload.trackingId || `evt-${payload.notificationId}`,
  signatureOverride = ""
} = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const timestamp = String(Date.now());
  const digest = createHmac("sha256", webhookSecret)
    .update(`${headerEventId}.${timestamp}.`, "utf8")
    .update(rawBody)
    .digest("hex");
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  await runtime.pingramSmsWebhook({
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pingram-id": headerEventId,
      "x-pingram-timestamp": timestamp,
      "x-pingram-signature": signatureOverride || `v1,${digest}`
    },
    rawBody
  }, response);
  return response;
}

async function clearCollections() {
  for (const name of [
    "ownerSmsAttempts",
    "ownerSmsProviderMessageIndex",
    "ownerSmsWebhookReceipts",
    "ownerSmsRateLimits",
    "ownerSmsOrganizationState",
    "ownerSmsProviderControls",
    "ownerSmsOutbox"
  ]) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    if (!snapshot.empty) await batch.commit();
  }
}

await clearCollections();

// A valid delivery callback may arrive before the provider binding. It remains
// durable, then the binding trigger reprocesses it without another send.
const trackingId = "pingram-track-early-delivery";
const earlyAttempt = acceptedAttempt("sms_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", trackingId);
const earlyAttemptRef = db.collection("ownerSmsAttempts").doc(earlyAttempt.attemptId);
await earlyAttemptRef.set(earlyAttempt);
const deliveryReceiptId = buildOwnerSmsWebhookReceiptId({
  provider: "pingram",
  eventType: "sms_delivered",
  providerTrackingId: trackingId
});
const deliveryReceiptRef = db.collection("ownerSmsWebhookReceipts").doc(deliveryReceiptId);
const rejectedSignature = await invokeSignedPingramWebhook({
  eventType: "SMS_DELIVERED",
  trackingId: "pingram-track-invalid-signature",
  notificationId: "pingram-notification-invalid-signature",
  channel: "SMS"
}, {
  headerEventId: "pingram-track-invalid-signature",
  signatureOverride: `v1,${"0".repeat(64)}`
});
assert.equal(rejectedSignature.statusCode, 400);
assert.equal(
  (await db.collection("ownerSmsWebhookReceipts")
    .where("providerTrackingId", "==", "pingram-track-invalid-signature")
    .get()).empty,
  true
);
const deliveredIngress = await invokeSignedPingramWebhook({
  eventType: "SMS_DELIVERED",
  trackingId,
  notificationId: "pingram-notification-early-delivery",
  channel: "SMS"
});
assert.equal(deliveredIngress.statusCode, 200);
assert.equal(deliveredIngress.body.received, true);
assert.equal((await deliveryReceiptRef.get()).data().state, "received");
await runtime.processPingramSmsWebhookReceipt.run(
  await deliveryReceiptRef.get(),
  { params: { receiptId: deliveryReceiptId } }
);
assert.equal((await deliveryReceiptRef.get()).data().state, "pending_binding");

const bindingId = createHash("sha256")
  .update([
    "quotepilot-owner-sms-v1",
    "provider-message",
    "pingram",
    trackingId
  ].join("|"), "utf8")
  .digest("hex");
const bindingRef = db.collection("ownerSmsProviderMessageIndex").doc(bindingId);
await bindingRef.set({
  schemaVersion: 1,
  provider: "pingram",
  providerTrackingId: trackingId,
  attemptId: earlyAttempt.attemptId,
  organizationId,
  recipientFingerprint: fingerprint,
  configurationGeneration: generation,
  providerConfigurationDigest: configurationDigest,
  bindingState: "provider_accepted",
  boundAtISO: iso(2)
});
await runtime.reconcilePingramSmsProviderBinding.run(
  await bindingRef.get(),
  { params: { bindingId: bindingRef.id } }
);
assert.equal((await deliveryReceiptRef.get()).data().state, "processed");
assert.equal((await earlyAttemptRef.get()).data().state, OWNER_SMS_ATTEMPT_STATES.DELIVERED);

const readiness = await db.collection("ownerSmsProviderControls")
  .where("kind", "==", "provider_readiness")
  .get();
assert.equal(readiness.size, 1);
assert.equal(readiness.docs[0].data().configurationGeneration, generation);
assert.equal(readiness.docs[0].data().signedDeliveryReceiptId, deliveryReceiptId);

// The signed diagnostic readiness permits a later automatic outbox command.
const readyOutbox = outboxDocument("evt-ready", "Deposit paid for Q-1001. Amount $10.00.");
const readyOutboxRef = db.collection("ownerSmsOutbox").doc("outbox-ready");
await readyOutboxRef.set(readyOutbox);
await runtime.reserveOwnerSmsOutbox.run(
  await readyOutboxRef.get(),
  { params: { outboxId: readyOutboxRef.id } }
);
const finalizedReadyOutbox = (await readyOutboxRef.get()).data();
assert.equal(finalizedReadyOutbox.state, "attempt_reserved");
assert.equal(Object.hasOwn(finalizedReadyOutbox, "messageBody"), false);
assert.equal(
  (await db.collection("ownerSmsAttempts").doc(readyOutbox.attemptId).get()).exists,
  true
);

// Contradictory signed terminal events quarantine both receipts and establish
// a provider-wide operator hold, even when the first event already established
// diagnostic readiness.
const failedReceiptId = buildOwnerSmsWebhookReceiptId({
  provider: "pingram",
  eventType: "sms_failed",
  providerTrackingId: trackingId
});
const failedReceiptRef = db.collection("ownerSmsWebhookReceipts").doc(failedReceiptId);
const failedIngress = await invokeSignedPingramWebhook({
  eventType: "SMS_FAILED",
  trackingId,
  notificationId: "pingram-notification-conflicting-failure",
  channel: "SMS",
  failureCode: "carrier_rejected"
});
assert.equal(failedIngress.statusCode, 200);
assert.equal(
  (await failedReceiptRef.get()).data().state,
  "requires_review_conflicting_events"
);
assert.equal(
  (await deliveryReceiptRef.get()).data().state,
  "requires_review_conflicting_events"
);
const conflictSuppressions = await db.collection("ownerSmsProviderControls")
  .where("kind", "==", "provider_suppression")
  .get();
assert.equal(conflictSuppressions.size, 1);
assert.equal(
  conflictSuppressions.docs[0].data().safeReason,
  "conflicting_terminal_provider_events"
);

// A signed unsubscribe signal creates a global hold. It is replay-stable and
// blocks/redacts subsequent automatic outbox work without a provider call.
const unsubscribePayload = {
  eventType: "SMS_UNSUBSCRIBE",
  notificationId: "pingram-notification-unsubscribe",
  channel: "SMS"
};
const unsubscribeIngress = await invokeSignedPingramWebhook(unsubscribePayload, {
  headerEventId: "pingram-event-unsubscribe"
});
assert.equal(unsubscribeIngress.statusCode, 200);
const unsubscribeReceipts = await db.collection("ownerSmsWebhookReceipts")
  .where("eventType", "==", "sms_unsubscribe")
  .get();
assert.equal(unsubscribeReceipts.size, 1);
const persistedOptOutReceiptRef = unsubscribeReceipts.docs[0].ref;
assert.equal(unsubscribeReceipts.docs[0].data().state, "processed_opt_out_hold");
const suppressions = await db.collection("ownerSmsProviderControls")
  .where("kind", "==", "provider_suppression")
  .get();
assert.equal(suppressions.size, 1);
assert.equal(suppressions.docs[0].data().state, "suppressed");
const duplicateUnsubscribeIngress = await invokeSignedPingramWebhook(unsubscribePayload, {
  headerEventId: "pingram-event-unsubscribe"
});
assert.equal(duplicateUnsubscribeIngress.statusCode, 200);
assert.equal(duplicateUnsubscribeIngress.body.duplicate, true);
await runtime.processPingramSmsWebhookReceipt.run(
  await persistedOptOutReceiptRef.get(),
  { params: { receiptId: persistedOptOutReceiptRef.id } }
);

const heldOutbox = outboxDocument("evt-held", "Deposit paid for Q-1002. Amount $10.00.");
const heldOutboxRef = db.collection("ownerSmsOutbox").doc("outbox-held");
await heldOutboxRef.set(heldOutbox);
await runtime.reserveOwnerSmsOutbox.run(
  await heldOutboxRef.get(),
  { params: { outboxId: heldOutboxRef.id } }
);
const finalizedHeldOutbox = (await heldOutboxRef.get()).data();
assert.equal(finalizedHeldOutbox.state, "not_queued");
assert.equal(Object.hasOwn(finalizedHeldOutbox, "messageBody"), false);
assert.equal(
  (await db.collection("ownerSmsAttempts").doc(heldOutbox.attemptId).get()).exists,
  false
);

process.env.NOTIFICATIONS_SMS_PROVIDER = "twilio";
const switchedProviderOutbox = outboxDocument(
  "evt-provider-switch-held",
  "Deposit paid for Q-1004. Amount $10.00."
);
const switchedProviderOutboxRef = db.collection("ownerSmsOutbox")
  .doc("outbox-provider-switch-held");
await switchedProviderOutboxRef.set(switchedProviderOutbox);
await runtime.reserveOwnerSmsOutbox.run(
  await switchedProviderOutboxRef.get(),
  { params: { outboxId: switchedProviderOutboxRef.id } }
);
assert.equal((await switchedProviderOutboxRef.get()).data().state, "not_queued");
assert.equal(
  (await db.collection("ownerSmsAttempts").doc(switchedProviderOutbox.attemptId).get()).exists,
  false
);
process.env.NOTIFICATIONS_SMS_PROVIDER = "pingram";
await runtime.reserveOwnerSmsOutbox.run(
  await heldOutboxRef.get(),
  { params: { outboxId: heldOutboxRef.id } }
);
assert.equal((await heldOutboxRef.get()).data().state, "not_queued");
assert.equal(
  (await db.collection("ownerSmsAttempts").doc(heldOutbox.attemptId).get()).exists,
  false
);

const staleReservation = {
  ...outboxDocument("evt-stale-reserving", "Deposit paid for Q-1003. Amount $10.00."),
  state: "reserving",
  reservationLeaseId: "sms_outbox_stale_fixture",
  reservationStartedAtISO: iso(0)
};
const staleReservationRef = db.collection("ownerSmsOutbox").doc("outbox-stale-reserving");
await staleReservationRef.set(staleReservation);
await runtime.reconcileOwnerSmsEvidence.run({}, {});
const recoveredReservation = (await staleReservationRef.get()).data();
assert.equal(recoveredReservation.state, "not_queued");
assert.equal(Object.hasOwn(recoveredReservation, "messageBody"), false);
assert.equal(
  (await db.collection("ownerSmsAttempts").doc(staleReservation.attemptId).get()).exists,
  false
);

// A retry that finds a claimed dispatch observes the active lease without
// calling the provider or racing the original invocation. Only the bounded
// stale reconciler later records uncertainty and redacts the body.
const recoveryQueued = queuedAttempt("sms_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const recoveryAttempt = {
  ...planOwnerSmsDispatch({
    attempt: recoveryQueued,
    leaseId: "lease_recovery",
    recipientFingerprint: fingerprint,
    nowISO: iso(1)
  }),
  configurationGeneration: generation,
  providerConfigurationDigest: configurationDigest
};
const recoveryRef = db.collection("ownerSmsAttempts").doc(recoveryAttempt.attemptId);
await recoveryRef.set(recoveryAttempt);
await runtime.dispatchPingramOwnerSms.run(
  await recoveryRef.get(),
  { params: { attemptId: recoveryAttempt.attemptId } }
);
const duplicateObserved = (await recoveryRef.get()).data();
assert.equal(duplicateObserved.state, OWNER_SMS_ATTEMPT_STATES.DISPATCHING);
assert.equal(duplicateObserved.attemptCount, 1);
assert.equal(Object.hasOwn(duplicateObserved, "messageBody"), true);
await runtime.reconcileOwnerSmsEvidence.run({}, {});
const recovered = (await recoveryRef.get()).data();
assert.equal(recovered.state, OWNER_SMS_ATTEMPT_STATES.UNCERTAIN);
assert.equal(recovered.attemptCount, 1);
assert.equal(Object.hasOwn(recovered, "messageBody"), false);

console.log(JSON.stringify({
  ok: true,
  callbackBeforeBinding: "processed",
  signedDiagnosticReadiness: "ready",
  conflictingTerminalEvents: "suppressed_for_review",
  optOutHold: "suppressed",
  automaticOutboxAfterHold: "not_queued",
  delayedOutboxReplay: "did_not_resurrect",
  providerSwitchOptOut: "blocked",
  staleOutboxReservation: "recovered_without_send",
  claimedRetry: "lease_observed_then_stale_uncertain_without_resend"
}));
