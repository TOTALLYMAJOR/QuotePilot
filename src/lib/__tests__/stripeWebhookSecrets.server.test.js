import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  constructStripeWebhookEvent,
  normalizeStripeWebhookSecrets
} = require("../../../functions/stripeWebhookSecrets.js");
const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

const NEW_SECRET = "whsec_new_rotation_fixture_123456";
const OLD_SECRET = "whsec_old_rotation_fixture_123456";
const RAW_BODY = Buffer.from('{"id":"evt_rotation_fixture"}', "utf8");
const SIGNATURE = "t=1720000000,v1=fixture";

describe("Stripe webhook signing-secret rotation", () => {
  test("accepts one signing secret and returns the verified event", () => {
    const event = { id: "evt_new" };
    const constructEvent = vi.fn(() => event);

    expect(constructStripeWebhookEvent({
      rawBody: RAW_BODY,
      signature: SIGNATURE,
      webhookSecret: NEW_SECRET,
      webhooks: { constructEvent }
    })).toBe(event);
    expect(constructEvent).toHaveBeenCalledWith(RAW_BODY, SIGNATURE, NEW_SECRET);
  });

  test("tries the new secret first and then accepts the old overlap secret", () => {
    const event = { id: "evt_old_overlap" };
    const constructEvent = vi.fn((_rawBody, _signature, secret) => {
      if (secret === NEW_SECRET) throw new Error("provider detail must stay private");
      return event;
    });

    expect(constructStripeWebhookEvent({
      rawBody: RAW_BODY,
      signature: SIGNATURE,
      webhookSecret: `${NEW_SECRET},${OLD_SECRET}`,
      webhooks: { constructEvent }
    })).toBe(event);
    expect(constructEvent.mock.calls.map((call) => call[2])).toEqual([
      NEW_SECRET,
      OLD_SECRET
    ]);
  });

  test.each([
    "",
    "not-a-webhook-secret",
    `${NEW_SECRET},${NEW_SECRET}`,
    `${NEW_SECRET},${OLD_SECRET},whsec_third_rotation_fixture_123456`
  ])("rejects malformed, duplicate, or oversized overlap configuration: %s", (value) => {
    expect(() => normalizeStripeWebhookSecrets(value)).toThrow(
      "Stripe webhook signing-secret configuration is invalid."
    );
  });

  test("replaces provider verification detail with a fixed failure", () => {
    const constructEvent = vi.fn(() => {
      throw new Error("raw provider signature detail");
    });

    expect(() => constructStripeWebhookEvent({
      rawBody: RAW_BODY,
      signature: SIGNATURE,
      webhookSecret: `${NEW_SECRET},${OLD_SECRET}`,
      webhooks: { constructEvent }
    })).toThrow("Stripe webhook signature verification failed.");
    try {
      constructStripeWebhookEvent({
        rawBody: RAW_BODY,
        signature: SIGNATURE,
        webhookSecret: NEW_SECRET,
        webhooks: { constructEvent }
      });
    } catch (error) {
      expect(error.code).toBe("signature_verification_failed");
      expect(error.message).not.toContain("provider");
    }
  });

  test("preserves the Stripe webhooks receiver while verifying", () => {
    const webhooks = {
      signature: { expected: NEW_SECRET },
      constructEvent(_rawBody, _signature, secret) {
        if (this.signature.expected !== secret) throw new Error("wrong receiver");
        return { id: "evt_receiver_bound" };
      }
    };

    expect(constructStripeWebhookEvent({
      rawBody: RAW_BODY,
      signature: SIGNATURE,
      webhookSecret: NEW_SECRET,
      webhooks
    })).toEqual({ id: "evt_receiver_bound" });
  });

  test("passes the Stripe webhooks object at both production call sites", () => {
    expect(FUNCTIONS_INDEX_SOURCE.match(/webhooks: Stripe\.webhooks/g)).toHaveLength(2);
    expect(FUNCTIONS_INDEX_SOURCE).not.toContain(
      "constructEvent: Stripe.webhooks.constructEvent"
    );
  });
});
