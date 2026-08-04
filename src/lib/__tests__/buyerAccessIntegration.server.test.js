import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf(startMarker);
  const end = FUNCTIONS_INDEX_SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Unable to locate source contract between ${startMarker} and ${endMarker}.`);
  }
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

describe("buyer access Stripe endpoint isolation", () => {
  test("binds each buyer Stripe secret only to its least-privilege endpoint", () => {
    expect(occurrenceCount(
      FUNCTIONS_INDEX_SOURCE,
      "BUYER_ACCESS_STRIPE_SECRET_NAME"
    )).toBe(2);
    expect(occurrenceCount(
      FUNCTIONS_INDEX_SOURCE,
      "BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME"
    )).toBe(2);

    const checkout = sourceBetween(
      "exports.createBuyerAccessCheckout =",
      "exports.getBuyerAccessCheckoutStatus ="
    );
    expect(checkout).toContain(
      ".runWith({ secrets: [BUYER_ACCESS_STRIPE_SECRET_NAME] })"
    );
    expect(checkout).toContain("const stripe = getBuyerAccessStripeClient();");
    expect(checkout).toContain('appBaseUrl: readConfig("buyer_access_app_base_url")');
    expect(checkout).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");

    const buyerWebhook = sourceBetween(
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain(
      ".runWith({ secrets: [BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME] })"
    );
    expect(buyerWebhook).toContain("Stripe.webhooks.constructEvent");
    expect(buyerWebhook).not.toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
  });

  test("keeps buyer and quote webhook routing and deduplication separate", () => {
    const buyerWebhook = sourceBetween(
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    const buyerTypeGuard = buyerWebhook.indexOf("if (!isBuyerAccessSession(session))");
    const buyerDedupe = buyerWebhook.indexOf("stripe-buyer-${eventId}");
    expect(buyerTypeGuard).toBeGreaterThan(-1);
    expect(buyerDedupe).toBeGreaterThan(buyerTypeGuard);
    expect(buyerWebhook).toContain('ignored: "non_buyer_access_session"');
    expect(buyerWebhook).toContain("await processBuyerAccessWebhook({");

    const quoteWebhook = sourceBetween(
      "exports.stripeWebhook =",
      "res.json({ received: true });\n});"
    );
    const quoteBuyerGuard = quoteWebhook.indexOf("if (isBuyerAccessSession(session))");
    const quoteDedupe = quoteWebhook.indexOf("stripe-${eventId}");
    expect(quoteBuyerGuard).toBeGreaterThan(-1);
    expect(quoteDedupe).toBeGreaterThan(quoteBuyerGuard);
    expect(quoteWebhook).toContain(
      'ignored: "buyer_access_uses_dedicated_webhook"'
    );
    expect(quoteWebhook).not.toContain("processBuyerAccessWebhook");
    expect(quoteWebhook).toContain('readConfig("stripe.webhook_secret")');
    expect(quoteWebhook).toContain("stripe = getStripeClient();");
  });

  test("uses buyer-only mode, allowlist, and return URL configuration", () => {
    const buyerConfig = sourceBetween(
      "function getBuyerAccessStripeConfig",
      "function getEmailProvider"
    );
    expect(buyerConfig).toContain('readConfig("buyer_access_stripe_mode")');
    expect(buyerConfig).toContain('readConfig("buyer_access_stripe_secret_key")');
    expect(buyerConfig).not.toContain('readConfig("stripe.secret_key")');

    const runtime = sourceBetween(
      "function assertBuyerAccessRuntimeEnabled",
      "async function assertBuyerAccessPrincipal"
    );
    expect(runtime).toContain('readConfig("buyer_access_allowed_emails")');
    expect(runtime).toContain('readConfig("buyer_access_stripe_mode")');
  });

  test("marks every buyer provisioning record as controlled test data", () => {
    const orderPreparation = sourceBetween(
      "async function prepareBuyerAccessOrder",
      "async function restartBuyerAccessOrderAfterProviderExpiry"
    );
    expect(orderPreparation).toContain(
      "buyerAccessMode: BUYER_ACCESS_MODE"
    );
    expect(orderPreparation).toContain(
      "normalizeText(existing.buyerAccessMode) !== BUYER_ACCESS_MODE"
    );

    const provisioning = sourceBetween(
      "async function processBuyerAccessWebhook",
      "exports.buyerAccessStripeWebhook ="
    );
    for (const recordName of [
      "organizationRecord",
      "settingsRecord",
      "roleRecord",
      "provisioningOrderRecord"
    ]) {
      const recordStart = provisioning.indexOf(`const ${recordName} = {`);
      expect(recordStart).toBeGreaterThan(-1);
      expect(
        provisioning.slice(recordStart, recordStart + 1_800)
      ).toContain("buyerAccessMode: BUYER_ACCESS_MODE");
    }
  });

  test("requires invoice binding and makes already-active paid events audit-only", () => {
    const provisioning = sourceBetween(
      "async function processBuyerAccessWebhook",
      "exports.buyerAccessStripeWebhook ="
    );
    expect(provisioning).toContain(
      'requireInvoice: providerState === "paid"'
    );
    expect(provisioning).toContain("const stripeInvoiceId = binding.invoiceId;");

    const replayGuard = sourceBetween(
      'if (\n      providerState === "paid"',
      'if (providerState !== "paid")'
    );
    expect(replayGuard).toContain('transition.reason === "already_active"');
    expect(replayGuard).toContain("tx.create(dedupeRef, audit);");
    expect(replayGuard).toContain("active: false");
    expect(replayGuard).not.toContain("tx.set(");
    expect(replayGuard).not.toContain("syncPrincipalClaims");

    expect(FUNCTIONS_INDEX_SOURCE).toContain(
      "stripeInvoiceId: normalizeText(stripeInvoiceId)"
    );
    expect(provisioning).toContain("const organizationRecord = {");
    expect(provisioning).toContain("const provisioningOrderRecord = {");
    expect(occurrenceCount(provisioning, "stripeInvoiceId,")).toBeGreaterThanOrEqual(4);
  });

  test("does not return Stripe signature diagnostics to buyer webhook clients", () => {
    const buyerWebhook = sourceBetween(
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain(
      'res.status(400).send("Webhook verification failed.")'
    );
    expect(buyerWebhook).not.toContain(
      "Webhook verification failed: ${err.message}"
    );
  });
});
