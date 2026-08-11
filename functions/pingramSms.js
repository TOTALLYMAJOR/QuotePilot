"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { TextDecoder } = require("node:util");

const PINGRAM_API_ORIGINS = Object.freeze({
  US: "https://api.pingram.io",
  CA: "https://api.ca.pingram.io",
  EU: "https://api.eu.pingram.io"
});
const PINGRAM_ALLOWED_API_ORIGINS = Object.freeze(Object.values(PINGRAM_API_ORIGINS));
const ALLOWED_API_ORIGINS = new Set(PINGRAM_ALLOWED_API_ORIGINS);
const PINGRAM_SMS_MAX_MESSAGE_CHARACTERS = 800;
const PINGRAM_SMS_DEFAULT_TIMEOUT_MS = 5_000;
const PINGRAM_SMS_MAX_TIMEOUT_MS = 15_000;
const PINGRAM_SMS_MIN_TIMEOUT_MS = 10;
const PINGRAM_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const PINGRAM_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1_000;
const PINGRAM_RESPONSE_MAX_BODY_BYTES = 16 * 1024;
const DELIVERY_WEBHOOK_EVENTS = new Set(["SMS_DELIVERED", "SMS_FAILED"]);
const SUPPORTED_WEBHOOK_EVENTS = new Set([
  ...DELIVERY_WEBHOOK_EVENTS,
  "SMS_UNSUBSCRIBE",
  "SMS_SUBSCRIBE",
  "SMS_INBOUND"
]);

const API_KEY_PREFIX = "pingram_sk_";
const WEBHOOK_SECRET_PREFIX = "pingram_whsecret_";
const PINGRAM_SECRET_MAX_SUFFIX_CHARACTERS = 256;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const STABLE_TYPE_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_FAILURE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function apiOrigin(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return ALLOWED_API_ORIGINS.has(normalized) ? normalized : "";
}

function hasBoundedPrintableSecretSuffix(value, prefix) {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  if (!suffix.length || suffix.length > PINGRAM_SECRET_MAX_SUFFIX_CHARACTERS) return false;
  return Array.from(suffix).every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 0x21 && codePoint <= 0x7e;
  });
}

function isPingramApiKeyShape(value) {
  return hasBoundedPrintableSecretSuffix(value, API_KEY_PREFIX);
}

function isPingramWebhookSecretShape(value) {
  return hasBoundedPrintableSecretSuffix(value, WEBHOOK_SECRET_PREFIX);
}

function validatePingramSmsConfig({ apiOrigin: requestedOrigin, apiKey } = {}) {
  if (!apiOrigin(requestedOrigin)) {
    return { ok: false, reason: "invalid_api_origin" };
  }
  if (!isPingramApiKeyShape(apiKey)) {
    return { ok: false, reason: "invalid_api_key_shape" };
  }
  return { ok: true };
}

function validatePingramWebhookConfig({ webhookSecret } = {}) {
  if (!isPingramWebhookSecretShape(webhookSecret)) {
    return { ok: false, reason: "invalid_webhook_secret_shape" };
  }
  return { ok: true };
}

function isE164(value) {
  return typeof value === "string" && E164_PATTERN.test(value);
}

function isStableType(value) {
  return typeof value === "string" && STABLE_TYPE_PATTERN.test(value);
}

function characterCount(value) {
  return Array.from(value).length;
}

function validatePingramSmsRequest({ to, from, type, message } = {}) {
  if (!isE164(to)) return { ok: false, reason: "invalid_recipient" };
  if (from !== undefined && from !== null && from !== "" && !isE164(from)) {
    return { ok: false, reason: "invalid_sender" };
  }
  if (!isStableType(type)) return { ok: false, reason: "invalid_type" };
  if (
    typeof message !== "string"
    || !message.trim()
    || characterCount(message) > PINGRAM_SMS_MAX_MESSAGE_CHARACTERS
  ) {
    return { ok: false, reason: "invalid_message" };
  }
  return { ok: true };
}

function validTimeout(value) {
  return Number.isInteger(value)
    && value >= PINGRAM_SMS_MIN_TIMEOUT_MS
    && value <= PINGRAM_SMS_MAX_TIMEOUT_MS;
}

function safeProviderTrackingId(value) {
  return typeof value === "string" && SAFE_PROVIDER_ID_PATTERN.test(value)
    ? value
    : "";
}

async function readBoundedJson(response) {
  if (!response || typeof response.text !== "function") return { ok: false };

  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > PINGRAM_RESPONSE_MAX_BODY_BYTES) {
      return { ok: false };
    }
  }

  const text = await response.text();
  if (
    typeof text !== "string"
    || Buffer.byteLength(text, "utf8") > PINGRAM_RESPONSE_MAX_BODY_BYTES
  ) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function classifyPingramResponse(response) {
  if (!response || response.redirected === true || response.type === "opaqueredirect") {
    return { outcome: "indeterminate", reason: "unexpected_redirect" };
  }

  const status = Number(response.status);
  if (!Number.isInteger(status)) {
    return { outcome: "indeterminate", reason: "invalid_provider_response" };
  }
  if (status >= 300 && status <= 399) {
    return { outcome: "indeterminate", reason: "unexpected_redirect" };
  }
  if (status >= 400 && status <= 499) {
    return { outcome: "rejected", reason: "provider_http_4xx" };
  }
  if (status >= 500 && status <= 599) {
    let parsed;
    try {
      parsed = await readBoundedJson(response);
    } catch {
      parsed = { ok: false };
    }
    const trackingId = parsed.ok
      && isRecord(parsed.value)
      && isRecord(parsed.value.error)
      ? safeProviderTrackingId(parsed.value.trackingId)
      : "";
    return trackingId
      ? { outcome: "indeterminate", reason: "provider_http_5xx", trackingId }
      : { outcome: "indeterminate", reason: "provider_http_5xx" };
  }
  if (status !== 200) {
    return { outcome: "indeterminate", reason: "unexpected_http_status" };
  }

  const parsed = await readBoundedJson(response);
  if (!parsed.ok || !isRecord(parsed.value)) {
    return { outcome: "indeterminate", reason: "malformed_provider_response" };
  }

  const body = parsed.value;
  if (isRecord(body.error) && !("messages" in body)) {
    return { outcome: "rejected", reason: "provider_rejected" };
  }

  const trackingId = safeProviderTrackingId(body.trackingId);
  const messagesAreValid = Array.isArray(body.messages)
    && body.messages.length <= 100
    && body.messages.every((entry) => typeof entry === "string" && entry.length <= 512);
  if (!trackingId || !messagesAreValid || "error" in body) {
    return { outcome: "indeterminate", reason: "malformed_provider_response" };
  }
  return { outcome: "provider_accepted", trackingId };
}

async function sendPingramSms({
  apiOrigin: requestedOrigin,
  apiKey,
  to,
  from,
  type,
  message,
  timeoutMs = PINGRAM_SMS_DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = validatePingramSmsConfig({ apiOrigin: requestedOrigin, apiKey });
  if (!config.ok) return { outcome: "rejected", reason: config.reason };

  const request = validatePingramSmsRequest({ to, from, type, message });
  if (!request.ok) return { outcome: "rejected", reason: request.reason };
  if (!validTimeout(timeoutMs) || typeof fetchImpl !== "function") {
    return { outcome: "rejected", reason: "invalid_transport_configuration" };
  }

  const origin = apiOrigin(requestedOrigin);
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ outcome: "indeterminate", reason: "transport_timeout" });
    }, timeoutMs);
  });

  const payload = { type, to, message };
  if (from !== undefined && from !== null && from !== "") payload.from = from;

  const operation = (async () => {
    const response = await fetchImpl(`${origin}/sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: controller.signal
    });
    return classifyPingramResponse(response);
  })();

  try {
    return await Promise.race([operation, timeout]);
  } catch {
    return {
      outcome: "indeterminate",
      reason: timedOut ? "transport_timeout" : "transport_outcome_unknown"
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function rawBodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return Buffer.from(rawBody);
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  return null;
}

function singleHeader(headers, requestedName) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    const value = headers.get(requestedName);
    return typeof value === "string" ? value.trim() : "";
  }
  if (!isRecord(headers)) return "";
  const matches = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === requestedName.toLowerCase());
  if (matches.length !== 1 || typeof matches[0][1] !== "string") return "";
  return matches[0][1].trim();
}

function safeFailureCode(value) {
  if (typeof value !== "string") return "unspecified";
  const normalized = value.trim();
  return SAFE_FAILURE_CODE_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : "unspecified";
}

function buildPingramSmsSemanticEventKey({
  eventType,
  headerEventId,
  trackingId,
  notificationId,
  lastTrackingId
} = {}) {
  const hasHeaderEventId = headerEventId !== undefined
    && headerEventId !== null
    && headerEventId !== "";
  const hasNotificationId = notificationId !== undefined
    && notificationId !== null
    && notificationId !== "";
  const hasLastTrackingId = lastTrackingId !== undefined
    && lastTrackingId !== null
    && lastTrackingId !== "";
  const safeHeaderEventId = hasHeaderEventId
    ? safeProviderTrackingId(headerEventId)
    : safeProviderTrackingId(trackingId);
  const safeNotificationId = !hasNotificationId
    ? ""
    : safeProviderTrackingId(notificationId);
  const safeLastTrackingId = !hasLastTrackingId
    ? ""
    : safeProviderTrackingId(lastTrackingId);
  if (
    !SUPPORTED_WEBHOOK_EVENTS.has(eventType)
    || !safeHeaderEventId
    || (hasNotificationId && !safeNotificationId)
    || (hasLastTrackingId && !safeLastTrackingId)
  ) {
    return "";
  }
  const identity = [
    "pingram-sms-event-v2",
    `event:${eventType}`,
    `header:${safeHeaderEventId}`
  ];
  if (safeNotificationId) identity.push(`notification:${safeNotificationId}`);
  if (safeLastTrackingId) identity.push(`last-tracking:${safeLastTrackingId}`);
  const digest = createHash("sha256")
    .update(identity.join("|"))
    .digest("hex");
  return `pgsms_${digest}`;
}

function isInboundStop(value) {
  return typeof value === "string" && value.trim().toUpperCase() === "STOP";
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function webhookFailure(reason) {
  return { ok: false, reason };
}

function verifyPingramSmsWebhook({
  rawBody,
  headers,
  webhookSecret,
  nowMs = Date.now()
} = {}) {
  const config = validatePingramWebhookConfig({ webhookSecret });
  if (!config.ok) return webhookFailure(config.reason);

  const bodyBuffer = rawBodyBuffer(rawBody);
  if (!bodyBuffer) return webhookFailure("invalid_raw_body");
  if (bodyBuffer.length > PINGRAM_WEBHOOK_MAX_BODY_BYTES) {
    return webhookFailure("payload_too_large");
  }

  const headerEventId = singleHeader(headers, "X-Pingram-Id");
  const timestampText = singleHeader(headers, "X-Pingram-Timestamp");
  const signature = singleHeader(headers, "X-Pingram-Signature");
  if (!safeProviderTrackingId(headerEventId) || !/^\d{13}$/.test(timestampText)) {
    return webhookFailure("invalid_headers");
  }
  if (!Number.isFinite(nowMs)) return webhookFailure("invalid_clock");
  const timestampMs = Number(timestampText);
  if (
    !Number.isSafeInteger(timestampMs)
    || Math.abs(nowMs - timestampMs) > PINGRAM_WEBHOOK_TOLERANCE_MS
  ) {
    return webhookFailure("stale_timestamp");
  }

  const signatureMatch = /^v1,([a-fA-F0-9]{64})$/.exec(signature);
  if (!signatureMatch) {
    return webhookFailure(signature.startsWith("v")
      ? "unsupported_signature_version"
      : "invalid_signature");
  }
  const expected = createHmac("sha256", webhookSecret)
    .update(`${headerEventId}.${timestampText}.`, "utf8")
    .update(bodyBuffer)
    .digest();
  const observed = Buffer.from(signatureMatch[1], "hex");
  if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) {
    return webhookFailure("invalid_signature");
  }

  let payload;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bodyBuffer);
    payload = JSON.parse(json);
  } catch {
    return webhookFailure("invalid_payload");
  }
  if (!isRecord(payload)) return webhookFailure("invalid_payload");
  if (!SUPPORTED_WEBHOOK_EVENTS.has(payload.eventType)) {
    return webhookFailure("unsupported_event");
  }

  let event;
  let semanticEventKey;
  if (DELIVERY_WEBHOOK_EVENTS.has(payload.eventType)) {
    if (payload.trackingId !== headerEventId) {
      return webhookFailure("tracking_id_mismatch");
    }
    if (payload.channel !== "SMS") return webhookFailure("unsupported_event");
    const trackingId = safeProviderTrackingId(payload.trackingId);
    const notificationId = safeProviderTrackingId(payload.notificationId);
    if (!trackingId || !notificationId) return webhookFailure("invalid_payload");
    event = {
      eventType: payload.eventType,
      channel: "SMS",
      headerEventId,
      trackingId,
      notificationId
    };
    if (payload.eventType === "SMS_FAILED") {
      event.failureCode = safeFailureCode(payload.failureCode);
    }
    semanticEventKey = buildPingramSmsSemanticEventKey({
      eventType: payload.eventType,
      headerEventId,
      notificationId
    });
  } else if (payload.eventType === "SMS_UNSUBSCRIBE") {
    if (payload.channel !== "SMS") return webhookFailure("unsupported_event");
    const notificationId = safeProviderTrackingId(payload.notificationId);
    if (!notificationId) return webhookFailure("invalid_payload");
    event = {
      eventType: payload.eventType,
      channel: "SMS",
      headerEventId,
      notificationId,
      optOutSignal: true
    };
    semanticEventKey = buildPingramSmsSemanticEventKey({
      eventType: payload.eventType,
      headerEventId,
      notificationId
    });
  } else if (payload.eventType === "SMS_SUBSCRIBE") {
    if (payload.channel !== "SMS") return webhookFailure("unsupported_event");
    const notificationId = safeProviderTrackingId(payload.notificationId);
    const reportedTrackingId = safeProviderTrackingId(payload.trackingId);
    if (!notificationId || !reportedTrackingId) return webhookFailure("invalid_payload");
    event = {
      eventType: payload.eventType,
      channel: "SMS",
      headerEventId,
      notificationId,
      reportedTrackingId,
      optOutSignal: false
    };
    semanticEventKey = buildPingramSmsSemanticEventKey({
      eventType: payload.eventType,
      headerEventId,
      notificationId
    });
  } else {
    if (payload.channel !== undefined && payload.channel !== "SMS") {
      return webhookFailure("unsupported_event");
    }
    if (
      !isE164(payload.from)
      || !isE164(payload.to)
      || typeof payload.text !== "string"
      || !isIsoTimestamp(payload.receivedAt)
      || (payload.isReply !== undefined && typeof payload.isReply !== "boolean")
    ) {
      return webhookFailure("invalid_payload");
    }
    const lastTrackingId = payload.lastTrackingId === undefined
      || payload.lastTrackingId === null
      || payload.lastTrackingId === ""
      ? ""
      : safeProviderTrackingId(payload.lastTrackingId);
    if (payload.lastTrackingId && !lastTrackingId) return webhookFailure("invalid_payload");
    event = {
      eventType: payload.eventType,
      channel: "SMS",
      headerEventId,
      optOutSignal: isInboundStop(payload.text)
    };
    if (typeof payload.isReply === "boolean") event.isReply = payload.isReply;
    if (lastTrackingId) event.lastTrackingId = lastTrackingId;
    semanticEventKey = buildPingramSmsSemanticEventKey({
      eventType: payload.eventType,
      headerEventId,
      lastTrackingId
    });
  }

  return {
    ok: true,
    event,
    semanticEventKey
  };
}

module.exports = {
  PINGRAM_ALLOWED_API_ORIGINS,
  PINGRAM_API_ORIGINS,
  PINGRAM_SMS_DEFAULT_TIMEOUT_MS,
  PINGRAM_SMS_MAX_MESSAGE_CHARACTERS,
  PINGRAM_WEBHOOK_MAX_BODY_BYTES,
  PINGRAM_WEBHOOK_TOLERANCE_MS,
  buildPingramSmsSemanticEventKey,
  isPingramApiKeyShape,
  isPingramWebhookSecretShape,
  sendPingramSms,
  validatePingramSmsConfig,
  validatePingramSmsRequest,
  validatePingramWebhookConfig,
  verifyPingramSmsWebhook
};
