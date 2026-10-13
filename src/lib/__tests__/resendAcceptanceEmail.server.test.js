import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  RESEND_ACCEPTANCE_STATES,
  buildResendAcceptanceConfirmationToken,
  buildResendAcceptancePayload,
  classifyResendAcceptanceFailure,
  normalizeResendAcceptanceRequest,
  projectResendAcceptanceReceipt
} = require("../../../functions/resendAcceptanceTest.js");

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const RESEND_CLIENT_SOURCE = fs.readFileSync(
  new URL("../resendAcceptanceClient.js", import.meta.url),
  "utf8"
);

function exportedFunctionSource(name) {
  const marker = `exports.${name} =`;
  const start = FUNCTIONS_SOURCE.indexOf(marker);
  if (start < 0) throw new Error(`Missing exported Function ${name}.`);
  const next = FUNCTIONS_SOURCE.indexOf("\nexports.", start + marker.length);
  return FUNCTIONS_SOURCE.slice(start, next < 0 ? FUNCTIONS_SOURCE.length : next);
}

describe("Resend acceptance email authority", () => {
  test("accepts only an exact immutable request for a controlled quietpilot.us recipient", () => {
    const requestId = `email_test_${"a".repeat(32)}`;
    const recipientEmail = "flightcontrol@quietpilot.us";
    const confirmationToken = buildResendAcceptanceConfirmationToken(recipientEmail);

    expect(normalizeResendAcceptanceRequest({
      requestId,
      recipientEmail: " FlightControl@QuietPilot.us ",
      confirmationToken
    })).toEqual({ requestId, recipientEmail, confirmationToken });
    expect(() => normalizeResendAcceptanceRequest({
      requestId,
      recipientEmail: "someone@example.com",
      confirmationToken: "SEND RESEND TEST TO someone@example.com"
    })).toThrow(/controlled quietpilot\.us/);
    expect(() => normalizeResendAcceptanceRequest({
      requestId,
      recipientEmail: "not valid@quietpilot.us",
      confirmationToken: "SEND RESEND TEST TO not valid@quietpilot.us"
    })).toThrow(/controlled quietpilot\.us/);
    expect(() => normalizeResendAcceptanceRequest({
      requestId,
      recipientEmail,
      confirmationToken: "yes",
      subject: "injected"
    })).toThrow(/unsupported fields/);
  });

  test("builds server-owned content and a bounded public provider-acceptance receipt", () => {
    const payload = buildResendAcceptancePayload({
      requestId: `email_test_${"b".repeat(32)}`,
      recipientEmail: "flightcontrol@quietpilot.us",
      actorEmail: "admin@quietpilot.us",
      requestedAtISO: "2026-09-03T22:00:00.000Z"
    });
    expect(payload).toMatchObject({
      toEmail: "flightcontrol@quietpilot.us",
      subject: "QuotePilot Resend acceptance test",
      html: ""
    });
    expect(payload.text).toContain("Provider acceptance alone does not prove delivery");

    const receipt = projectResendAcceptanceReceipt({
      schemaVersion: 1,
      requestId: `email_test_${"b".repeat(32)}`,
      recipientEmail: "flightcontrol@quietpilot.us",
      state: RESEND_ACCEPTANCE_STATES.PROVIDER_ACCEPTED,
      providerMessageId: "provider-message-1",
      acceptedAtISO: "2026-09-03T22:00:01.000Z",
      actorUid: "private-uid",
      apiKey: "private-key"
    });
    expect(receipt).toMatchObject({
      ok: true,
      provider: "resend",
      providerMessageId: "provider-message-1",
      idempotent: false
    });
    expect(JSON.stringify(receipt)).not.toMatch(/private-uid|private-key|apiKey/);
  });

  test("makes ambiguous provider outcomes non-retryable", () => {
    expect(classifyResendAcceptanceFailure({ quoteDeliveryOutcome: "ambiguous" }))
      .toEqual({
        state: RESEND_ACCEPTANCE_STATES.OUTCOME_UNKNOWN,
        safeReason: "provider_outcome_unknown",
        retrySafe: false
      });
    expect(classifyResendAcceptanceFailure({ providerHttpStatus: 400 }))
      .toEqual({
        state: RESEND_ACCEPTANCE_STATES.DEFINITE_FAILURE,
        safeReason: "provider_http_400",
        retrySafe: true
      });
  });

  test("binds only the Resend secret, requires platform authority, and persists before contact", () => {
    const callable = exportedFunctionSource("sendResendAcceptanceTestEmail");
    expect(callable).toContain(".runWith({ secrets: [RESEND_API_KEY_SECRET_NAME] })");
    expect(callable).toContain('staff.role !== "admin" || !staff.platformAdmin');
    expect(callable).toContain("normalizeResendAcceptanceRequest(data)");
    expect(callable).toContain("tx.create(receiptRef, receipt)");
    expect(callable.indexOf("tx.create(receiptRef, receipt)"))
      .toBeLessThan(callable.indexOf("sendEmailViaResend({"));
    expect(callable).toContain("idempotencyKey: `quotepilot-resend-acceptance:");
    expect(callable).toContain("This email acceptance request is already recorded and will not be sent again");
    expect(callable).not.toContain("STRIPE_SECRET_NAME");
    expect(callable).not.toContain("PINGRAM_API_KEY_SECRET_NAME");
  });

  test("validates the callable receipt in the browser adapter without exposing secret-shaped keys", () => {
    expect(RESEND_CLIENT_SOURCE).toContain("export function createEmailTestRequestId");
    expect(RESEND_CLIENT_SOURCE).toContain("export function buildEmailTestConfirmationToken");
    expect(RESEND_CLIENT_SOURCE).toContain('httpsCallable(cloudFunctions, "sendResendAcceptanceTestEmail")');
    expect(RESEND_CLIENT_SOURCE).toContain("/secret|token|api.?key/i");
  });
});
