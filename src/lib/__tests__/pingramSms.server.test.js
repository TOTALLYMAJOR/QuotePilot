import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  PINGRAM_ALLOWED_API_ORIGINS,
  PINGRAM_API_ORIGINS,
  PINGRAM_SMS_MAX_MESSAGE_CHARACTERS,
  PINGRAM_WEBHOOK_MAX_BODY_BYTES,
  buildPingramSmsSemanticEventKey,
  isPingramApiKeyShape,
  isPingramWebhookSecretShape,
  sendPingramSms,
  validatePingramSmsConfig,
  validatePingramSmsRequest,
  validatePingramWebhookConfig,
  verifyPingramSmsWebhook
} = require("../../../functions/pingramSms.js");

const API_KEY = "pingram_" + "sk_test_0123456789abcdef";
const WEBHOOK_SECRET = "pingram_" + "whsecret_test_0123456789abcdef";
const NOW_MS = Date.parse("2026-08-11T16:00:00.000Z");
const TRACKING_ID = "trk_1234567890abcdef";
const NOTIFICATION_ID = "ntf_1234567890abcdef";
const HEADER_EVENT_ID = "evt_1234567890abcdef";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function smsRequest(overrides = {}) {
  return {
    apiOrigin: PINGRAM_API_ORIGINS.US,
    apiKey: API_KEY,
    to: "+13125550100",
    from: "+13125550101",
    type: "quote_follow_up",
    message: "Your quote is ready. Reply STOP to opt out.",
    ...overrides
  };
}

function webhookPayload(overrides = {}) {
  return {
    eventType: "SMS_DELIVERED",
    trackingId: TRACKING_ID,
    notificationId: NOTIFICATION_ID,
    channel: "SMS",
    userId: "customer-private-value",
    ...overrides
  };
}

function signedWebhook(payload, {
  headerEventId = payload.trackingId || HEADER_EVENT_ID,
  timestampMs = NOW_MS,
  secret = WEBHOOK_SECRET,
  rawBody = Buffer.from(JSON.stringify(payload), "utf8")
} = {}) {
  const timestamp = String(timestampMs);
  const digest = createHmac("sha256", secret)
    .update(`${headerEventId}.${timestamp}.`, "utf8")
    .update(rawBody)
    .digest("hex");
  return {
    rawBody,
    headers: {
      "X-Pingram-Id": headerEventId,
      "X-Pingram-Timestamp": timestamp,
      "X-Pingram-Signature": `v1,${digest}`
    },
    webhookSecret: secret,
    nowMs: NOW_MS
  };
}

describe("Pingram SMS server provider", () => {
  test("allows only the three documented HTTPS API origins and validates credential shape only", () => {
    expect(PINGRAM_ALLOWED_API_ORIGINS).toEqual([
      "https://api.pingram.io",
      "https://api.ca.pingram.io",
      "https://api.eu.pingram.io"
    ]);
    for (const apiOrigin of PINGRAM_ALLOWED_API_ORIGINS) {
      expect(validatePingramSmsConfig({ apiOrigin, apiKey: API_KEY })).toEqual({ ok: true });
    }
    expect(validatePingramSmsConfig({
      apiOrigin: "https://api.pingram.io.evil.example",
      apiKey: API_KEY
    })).toEqual({ ok: false, reason: "invalid_api_origin" });
    expect(validatePingramSmsConfig({
      apiOrigin: "http://api.pingram.io",
      apiKey: API_KEY
    })).toEqual({ ok: false, reason: "invalid_api_origin" });
    expect(validatePingramSmsConfig({
      apiOrigin: "https://api.pingram.io/sms",
      apiKey: API_KEY
    })).toEqual({ ok: false, reason: "invalid_api_origin" });
    expect(isPingramApiKeyShape(API_KEY)).toBe(true);
    const apiPrefix = "pingram_" + "sk_";
    const webhookPrefix = "pingram_" + "whsecret_";
    expect(isPingramApiKeyShape(`${apiPrefix}x`)).toBe(true);
    expect(isPingramApiKeyShape(`${apiPrefix}!~`)).toBe(true);
    expect(isPingramApiKeyShape(apiPrefix)).toBe(false);
    expect(isPingramApiKeyShape(`${apiPrefix}${"x".repeat(256)}`)).toBe(true);
    expect(isPingramApiKeyShape(`${apiPrefix}${"x".repeat(257)}`)).toBe(false);
    expect(isPingramApiKeyShape(`${apiPrefix}contains space`)).toBe(false);
    expect(isPingramApiKeyShape(`${API_KEY}\nInjected: value`)).toBe(false);
    expect(isPingramWebhookSecretShape(WEBHOOK_SECRET)).toBe(true);
    expect(isPingramWebhookSecretShape(`${webhookPrefix}x`)).toBe(true);
    expect(isPingramWebhookSecretShape(`${webhookPrefix}:~`)).toBe(true);
    expect(isPingramWebhookSecretShape(webhookPrefix)).toBe(false);
    expect(isPingramWebhookSecretShape(`${webhookPrefix}${"x".repeat(257)}`)).toBe(false);
    expect(isPingramWebhookSecretShape(`${webhookPrefix}tab\tvalue`)).toBe(false);
    expect(validatePingramWebhookConfig({ webhookSecret: WEBHOOK_SECRET })).toEqual({ ok: true });
    expect(JSON.stringify(validatePingramSmsConfig({
      apiOrigin: PINGRAM_API_ORIGINS.US,
      apiKey: API_KEY
    }))).not.toContain(API_KEY);
  });

  test("requires E.164 addresses, a stable type, and a nonempty message of at most 800 characters", () => {
    expect(validatePingramSmsRequest(smsRequest({
      message: "x".repeat(PINGRAM_SMS_MAX_MESSAGE_CHARACTERS)
    }))).toEqual({ ok: true });
    expect(validatePingramSmsRequest(smsRequest({ to: "312-555-0100" })))
      .toEqual({ ok: false, reason: "invalid_recipient" });
    expect(validatePingramSmsRequest(smsRequest({ from: "13125550101" })))
      .toEqual({ ok: false, reason: "invalid_sender" });
    expect(validatePingramSmsRequest(smsRequest({ type: "Quote Follow Up" })))
      .toEqual({ ok: false, reason: "invalid_type" });
    expect(validatePingramSmsRequest(smsRequest({ message: "  \n " })))
      .toEqual({ ok: false, reason: "invalid_message" });
    expect(validatePingramSmsRequest(smsRequest({
      message: "x".repeat(PINGRAM_SMS_MAX_MESSAGE_CHARACTERS + 1)
    }))).toEqual({ ok: false, reason: "invalid_message" });
  });

  test("makes exactly one documented POST and returns only provider acceptance and tracking identity", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      trackingId: TRACKING_ID,
      messages: ["accepted"]
    }));
    const result = await sendPingramSms(smsRequest({ fetchImpl }));

    expect(result).toEqual({ outcome: "provider_accepted", trackingId: TRACKING_ID });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.pingram.io/sms");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("manual");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    });
    expect(Object.keys(options.headers)).not.toContain("Idempotency-Key");
    expect(JSON.parse(options.body)).toEqual({
      type: "quote_follow_up",
      to: "+13125550100",
      message: "Your quote is ready. Reply STOP to opt out.",
      from: "+13125550101"
    });
  });

  test("maps a documented HTTP 200 error object to a definite rejection without reflecting provider data", async () => {
    const providerDetail = "provider-private-error-detail";
    const result = await sendPingramSms(smsRequest({
      fetchImpl: vi.fn(async () => jsonResponse({
        trackingId: TRACKING_ID,
        error: { code: "blocked", message: providerDetail, fix: "provider-private-fix" }
      }))
    }));
    expect(result).toEqual({ outcome: "rejected", reason: "provider_rejected" });
    expect(result).not.toHaveProperty("trackingId");
    expect(JSON.stringify(result)).not.toContain(providerDetail);
  });

  test.each([
    [400, "rejected", "provider_http_4xx"],
    [429, "rejected", "provider_http_4xx"],
    [500, "indeterminate", "provider_http_5xx"],
    [502, "indeterminate", "provider_http_5xx"]
  ])("maps HTTP %i without returning the response body", async (status, outcome, reason) => {
    const fetchImpl = vi.fn(async () => new Response("provider-private-body", { status }));
    const result = await sendPingramSms(smsRequest({ fetchImpl }));
    expect(result).toEqual({ outcome, reason });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("provider-private-body");
  });

  test("preserves only a safe tracking ID from a bounded structured 5xx response", async () => {
    const providerDetail = "provider-private-5xx-detail";
    const result = await sendPingramSms(smsRequest({
      fetchImpl: vi.fn(async () => jsonResponse({
        trackingId: TRACKING_ID,
        error: { code: "provider_error", message: providerDetail }
      }, 503))
    }));
    expect(result).toEqual({
      outcome: "indeterminate",
      reason: "provider_http_5xx",
      trackingId: TRACKING_ID
    });
    expect(JSON.stringify(result)).not.toContain(providerDetail);

    expect(await sendPingramSms(smsRequest({
      fetchImpl: vi.fn(async () => jsonResponse({
        trackingId: "unsafe tracking id",
        error: { code: "provider_error" }
      }, 503))
    }))).toEqual({ outcome: "indeterminate", reason: "provider_http_5xx" });
  });

  test("does not follow redirects or issue another request", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://untrusted.example/collect" }
    }));
    expect(await sendPingramSms(smsRequest({ fetchImpl }))).toEqual({
      outcome: "indeterminate",
      reason: "unexpected_redirect"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([
    [new Response("not-json", { status: 200 })],
    [jsonResponse({ trackingId: TRACKING_ID })],
    [jsonResponse({ trackingId: TRACKING_ID, messages: "accepted" })],
    [jsonResponse({ trackingId: "unsafe tracking id", messages: [] })],
    [jsonResponse({ trackingId: TRACKING_ID, messages: [], error: {} })]
  ])("keeps malformed HTTP 200 responses indeterminate", async (response) => {
    const result = await sendPingramSms(smsRequest({
      fetchImpl: vi.fn(async () => response)
    }));
    expect(result).toEqual({
      outcome: "indeterminate",
      reason: "malformed_provider_response"
    });
    expect(result).not.toHaveProperty("trackingId");
  });

  test("keeps timeout and network failures indeterminate without exposing exception details", async () => {
    const networkDetail = "network-secret-detail";
    const networkFetch = vi.fn(async () => {
      throw new Error(networkDetail);
    });
    const networkResult = await sendPingramSms(smsRequest({ fetchImpl: networkFetch }));
    expect(networkResult).toEqual({
      outcome: "indeterminate",
      reason: "transport_outcome_unknown"
    });
    expect(JSON.stringify(networkResult)).not.toContain(networkDetail);
    expect(networkFetch).toHaveBeenCalledTimes(1);

    const timeoutFetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted provider detail")), {
        once: true
      });
    }));
    const timeoutResult = await sendPingramSms(smsRequest({
      fetchImpl: timeoutFetch,
      timeoutMs: 10
    }));
    expect(timeoutResult).toEqual({ outcome: "indeterminate", reason: "transport_timeout" });
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid configuration and payload before any provider call", async () => {
    const fetchImpl = vi.fn();
    expect(await sendPingramSms(smsRequest({
      apiOrigin: "https://api.pingram.io.invalid",
      fetchImpl
    }))).toEqual({ outcome: "rejected", reason: "invalid_api_origin" });
    expect(await sendPingramSms(smsRequest({
      apiKey: "not-a-pingram-key",
      fetchImpl
    }))).toEqual({ outcome: "rejected", reason: "invalid_api_key_shape" });
    expect(await sendPingramSms(smsRequest({
      to: "not-e164",
      fetchImpl
    }))).toEqual({ outcome: "rejected", reason: "invalid_recipient" });
    expect(await sendPingramSms(smsRequest({
      timeoutMs: 60_000,
      fetchImpl
    }))).toEqual({ outcome: "rejected", reason: "invalid_transport_configuration" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Pingram SMS webhook verification", () => {
  test("verifies exact raw bytes and returns only a normalized delivered event", () => {
    const input = signedWebhook(webhookPayload());
    input.headers = {
      "x-pingram-id": input.headers["X-Pingram-Id"],
      "x-pingram-timestamp": input.headers["X-Pingram-Timestamp"],
      "x-pingram-signature": input.headers["X-Pingram-Signature"]
    };
    const result = verifyPingramSmsWebhook(input);
    expect(result).toEqual({
      ok: true,
      event: {
        eventType: "SMS_DELIVERED",
        channel: "SMS",
        headerEventId: TRACKING_ID,
        trackingId: TRACKING_ID,
        notificationId: NOTIFICATION_ID
      },
      semanticEventKey: buildPingramSmsSemanticEventKey({
        eventType: "SMS_DELIVERED",
        headerEventId: TRACKING_ID,
        notificationId: NOTIFICATION_ID
      })
    });
    expect(result.semanticEventKey).toMatch(/^pgsms_[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty("rawBody");
    expect(JSON.stringify(result)).not.toContain("customer-private-value");
    expect(JSON.stringify(result)).not.toContain(WEBHOOK_SECRET);
  });

  test("normalizes a safe failure code and includes bounded documented identities in the semantic key", () => {
    const first = verifyPingramSmsWebhook(signedWebhook(webhookPayload({
      eventType: "SMS_FAILED",
      failureCode: "CARRIER_REJECTED"
    })));
    const second = verifyPingramSmsWebhook(signedWebhook(webhookPayload({
      eventType: "SMS_FAILED",
      notificationId: "ntf_different_occurrence",
      failureCode: "customer@example.com"
    })));
    expect(first).toMatchObject({
      ok: true,
      event: { eventType: "SMS_FAILED", failureCode: "carrier_rejected" }
    });
    expect(second).toMatchObject({
      ok: true,
      event: { eventType: "SMS_FAILED", failureCode: "unspecified" }
    });
    expect(second.semanticEventKey).not.toBe(first.semanticEventKey);
  });

  test("rejects tampered bodies and signatures", () => {
    const original = signedWebhook(webhookPayload());
    expect(verifyPingramSmsWebhook({
      ...original,
      rawBody: Buffer.from(JSON.stringify(webhookPayload({ channel: "EMAIL" })), "utf8")
    })).toEqual({ ok: false, reason: "invalid_signature" });
    expect(verifyPingramSmsWebhook({
      ...original,
      headers: {
        ...original.headers,
        "X-Pingram-Signature": `v1,${"0".repeat(64)}`
      }
    })).toEqual({ ok: false, reason: "invalid_signature" });
  });

  test("rejects stale timestamps and unsupported signature versions", () => {
    const stale = signedWebhook(webhookPayload(), {
      timestampMs: NOW_MS - (5 * 60 * 1_000) - 1
    });
    expect(verifyPingramSmsWebhook(stale)).toEqual({ ok: false, reason: "stale_timestamp" });

    const wrongVersion = signedWebhook(webhookPayload());
    wrongVersion.headers["X-Pingram-Signature"] = wrongVersion.headers["X-Pingram-Signature"]
      .replace(/^v1,/, "v2,");
    expect(verifyPingramSmsWebhook(wrongVersion)).toEqual({
      ok: false,
      reason: "unsupported_signature_version"
    });
  });

  test("rejects raw webhook bodies larger than 64 KiB", () => {
    expect(verifyPingramSmsWebhook({
      rawBody: Buffer.alloc(PINGRAM_WEBHOOK_MAX_BODY_BYTES + 1, 0x61),
      headers: {},
      webhookSecret: WEBHOOK_SECRET,
      nowMs: NOW_MS
    })).toEqual({ ok: false, reason: "payload_too_large" });
  });

  test("rejects a payload tracking ID that does not match the signed header identity", () => {
    const input = signedWebhook(webhookPayload(), {
      headerEventId: "trk_different_header_id"
    });
    expect(verifyPingramSmsWebhook(input)).toEqual({
      ok: false,
      reason: "tracking_id_mismatch"
    });
  });

  test.each([
    [webhookPayload({ channel: "EMAIL" })],
    [webhookPayload({ eventType: "SMS_UNKNOWN" })]
  ])("rejects unsupported webhook event authority", (payload) => {
    expect(verifyPingramSmsWebhook(signedWebhook(payload))).toEqual({
      ok: false,
      reason: "unsupported_event"
    });
  });

  test("recognizes documented unsubscribe without requiring a body tracking ID", () => {
    const privateUserId = "customer-private-unsubscribe-user";
    const result = verifyPingramSmsWebhook(signedWebhook({
      eventType: "SMS_UNSUBSCRIBE",
      notificationId: NOTIFICATION_ID,
      channel: "SMS",
      userId: privateUserId
    }));
    expect(result).toEqual({
      ok: true,
      event: {
        eventType: "SMS_UNSUBSCRIBE",
        channel: "SMS",
        headerEventId: HEADER_EVENT_ID,
        notificationId: NOTIFICATION_ID,
        optOutSignal: true
      },
      semanticEventKey: buildPingramSmsSemanticEventKey({
        eventType: "SMS_UNSUBSCRIBE",
        headerEventId: HEADER_EVENT_ID,
        notificationId: NOTIFICATION_ID
      })
    });
    expect(JSON.stringify(result)).not.toContain(privateUserId);
  });

  test("recognizes subscribe when its documented tracking ID differs from the signed header without granting consent", () => {
    const privateUserId = "customer-private-subscribe-user";
    const result = verifyPingramSmsWebhook(signedWebhook({
      eventType: "SMS_SUBSCRIBE",
      trackingId: TRACKING_ID,
      notificationId: NOTIFICATION_ID,
      channel: "SMS",
      userId: privateUserId
    }, { headerEventId: HEADER_EVENT_ID }));
    expect(result).toEqual({
      ok: true,
      event: {
        eventType: "SMS_SUBSCRIBE",
        channel: "SMS",
        headerEventId: HEADER_EVENT_ID,
        notificationId: NOTIFICATION_ID,
        reportedTrackingId: TRACKING_ID,
        optOutSignal: false
      },
      semanticEventKey: buildPingramSmsSemanticEventKey({
        eventType: "SMS_SUBSCRIBE",
        headerEventId: HEADER_EVENT_ID,
        notificationId: NOTIFICATION_ID
      })
    });
    expect(result.event).not.toHaveProperty("consentGranted");
    expect(result.event).not.toHaveProperty("resubscribed");
    expect(JSON.stringify(result)).not.toContain(privateUserId);
  });

  test("recognizes the Events-page inbound variant while minimizing phone, message, user, and media data", () => {
    const privatePhone = "+13125550123";
    const privateMessage = "Please call me about the private quote";
    const privateUserId = "customer-private-inbound-user";
    const lastTrackingId = "trk_last_outbound_123";
    const result = verifyPingramSmsWebhook(signedWebhook({
      eventType: "SMS_INBOUND",
      from: privatePhone,
      to: "+13125550124",
      text: privateMessage,
      receivedAt: "2026-08-11T16:00:00.000Z",
      userId: privateUserId,
      lastTrackingId,
      media: [{ url: "https://provider-private.example/media.jpg", contentType: "image/jpeg" }]
    }));
    expect(result).toEqual({
      ok: true,
      event: {
        eventType: "SMS_INBOUND",
        channel: "SMS",
        headerEventId: HEADER_EVENT_ID,
        optOutSignal: false,
        lastTrackingId
      },
      semanticEventKey: buildPingramSmsSemanticEventKey({
        eventType: "SMS_INBOUND",
        headerEventId: HEADER_EVENT_ID,
        lastTrackingId
      })
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(privatePhone);
    expect(serialized).not.toContain(privateMessage);
    expect(serialized).not.toContain(privateUserId);
    expect(serialized).not.toContain("provider-private.example");
  });

  test("recognizes the Inbound-page standalone STOP variant as an opt-out signal", () => {
    const result = verifyPingramSmsWebhook(signedWebhook({
      eventType: "SMS_INBOUND",
      from: "+13125550123",
      to: "+13125550124",
      text: "  stop  ",
      receivedAt: "2026-08-11T16:00:00.000Z",
      isReply: false
    }));
    expect(result).toEqual({
      ok: true,
      event: {
        eventType: "SMS_INBOUND",
        channel: "SMS",
        headerEventId: HEADER_EVENT_ID,
        optOutSignal: true,
        isReply: false
      },
      semanticEventKey: buildPingramSmsSemanticEventKey({
        eventType: "SMS_INBOUND",
        headerEventId: HEADER_EVENT_ID,
        lastTrackingId: ""
      })
    });
  });

  test("uses only bounded safe identifiers when deriving semantic callback keys", () => {
    const common = {
      eventType: "SMS_INBOUND",
      headerEventId: HEADER_EVENT_ID,
      lastTrackingId: "trk_last_one"
    };
    expect(buildPingramSmsSemanticEventKey(common)).toBe(buildPingramSmsSemanticEventKey(common));
    expect(buildPingramSmsSemanticEventKey({
      ...common,
      lastTrackingId: "trk_last_two"
    })).not.toBe(buildPingramSmsSemanticEventKey(common));
    expect(buildPingramSmsSemanticEventKey({
      ...common,
      headerEventId: "x".repeat(257)
    })).toBe("");
    expect(buildPingramSmsSemanticEventKey({
      ...common,
      notificationId: "unsafe notification id"
    })).toBe("");
    expect(buildPingramSmsSemanticEventKey({
      ...common,
      notificationId: 0
    })).toBe("");
  });

  test("rejects malformed webhook-secret shape without reflecting it", () => {
    const invalidSecret = "not-a-pingram-webhook-secret";
    const result = verifyPingramSmsWebhook({
      ...signedWebhook(webhookPayload()),
      webhookSecret: invalidSecret
    });
    expect(result).toEqual({ ok: false, reason: "invalid_webhook_secret_shape" });
    expect(JSON.stringify(result)).not.toContain(invalidSecret);
  });
});
