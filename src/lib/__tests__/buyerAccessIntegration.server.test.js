import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const BUYER_ACCESS_SOURCE = fs.readFileSync(
  new URL("../../../functions/buyerAccess.js", import.meta.url),
  "utf8"
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "Unable to locate source contract between " + startMarker + " and " + endMarker + "."
    );
  }
  return source.slice(start, end);
}

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

describe("buyer access Invoice endpoint isolation", () => {
  test("binds least-privilege secrets to public create and dedicated webhook endpoints", () => {
    const create = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.createBuyerAccessInvoice =",
      "exports.getBuyerAccessInvoiceStatus ="
    );
    expect(create).toContain(
      "secrets: [BUYER_ACCESS_STRIPE_SECRET_NAME, BUYER_ACCESS_TURNSTILE_SECRET_NAME]"
    );
    expect(create).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");

    const status = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.getBuyerAccessInvoiceStatus =",
      "exports.createDepositCheckout ="
    );
    expect(status).not.toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(status).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");
    expect(status).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");

    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain(
      ".runWith({ secrets: [BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME] })"
    );
    expect(buyerWebhook).not.toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(buyerWebhook).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");
  });

  test("pins only the buyer client and dedicated webhook to Stripe API 2024-06-20", () => {
    const quoteClient = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getStripeClient()",
      "function getStripeMode()"
    );
    const buyerClient = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getBuyerAccessStripeClient()",
      "function assertBuyerAccessRuntimeEnabled()"
    );
    expect(BUYER_ACCESS_SOURCE).toContain(
      'const BUYER_ACCESS_STRIPE_API_VERSION = "2024-06-20";'
    );
    expect(quoteClient).toContain("return new Stripe(secretKey);");
    expect(quoteClient).not.toContain("BUYER_ACCESS_STRIPE_API_VERSION");
    expect(buyerClient).toContain(
      "return new Stripe(secretKey, { apiVersion: BUYER_ACCESS_STRIPE_API_VERSION });"
    );
    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain(
      "normalizeText(event?.api_version) !== BUYER_ACCESS_STRIPE_API_VERSION"
    );
  });

  test("verifies a fresh Turnstile token before every Auth, invite, or order lookup", () => {
    const create = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.createBuyerAccessInvoice =",
      "exports.getBuyerAccessInvoiceStatus ="
    );
    const turnstile = create.indexOf("await verifyBuyerAccessTurnstile({");
    const identity = create.indexOf("await assertPublicBuyerIdentityAvailable");
    const order = create.indexOf("await preparePublicBuyerAccessOrder({");
    expect(turnstile).toBeGreaterThan(-1);
    expect(identity).toBeGreaterThan(turnstile);
    expect(order).toBeGreaterThan(identity);
    expect(create).not.toContain("context?.auth");
    expect(create).not.toContain("assertBuyerAccessPrincipal");

    const verification = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function verifyBuyerAccessTurnstile",
      "function assertBuyerAccessOrderRequest"
    );
    expect(verification).toContain(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    expect(verification).toContain("remoteip: requestIp");
    expect(verification).not.toContain("idempotency_key");
    expect(verification).not.toContain("requestId");
  });

  test("uses only trusted request IP seams and stable rolling-window rate documents", () => {
    const trustedIp = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getTrustedBuyerAccessRequestIp",
      "function buyerAccessRateLimitDocumentIds"
    );
    expect(trustedIp).toContain("context?.rawRequest?.ip");
    expect(trustedIp).toContain("context?.rawRequest?.socket?.remoteAddress");
    expect(trustedIp.toLowerCase()).not.toContain("x-forwarded-for");

    const rateLimits = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function buyerAccessRateLimitDocumentIds",
      "async function persistBuyerAccessProviderStep"
    );
    expect(rateLimits).toContain("ip: `ip-");
    expect(rateLimits).toContain("email: `email-");
    expect(rateLimits).toContain("windowStartedAtISO");
    expect(rateLimits).toContain("windowExpiresAtISO");
    expect(rateLimits).not.toContain("hourBucket");
    expect(rateLimits).not.toContain("dayBucket");
  });

  test("removes allowlist and legacy buyer Checkout Session code completely", () => {
    const combined = FUNCTIONS_INDEX_SOURCE + BUYER_ACCESS_SOURCE;
    for (const retired of [
      "BUYER_ACCESS_ALLOWED_EMAILS",
      "buyer_access_allowed_emails",
      "createBuyerAccessCheckout",
      "getBuyerAccessCheckoutStatus",
      "assertBuyerAccessSessionBinding",
      "isBuyerAccessSession",
      "buyerAccessOrderIdForUid",
      "neutralizeBuyerAccessCheckoutSession"
    ]) {
      expect(combined).not.toContain(retired);
    }
  });

  test("creates Customer, send Invoice, one-dollar item, finalize, and send in order", () => {
    const createInvoice = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function createOrResumeBuyerAccessInvoice",
      "exports.createBuyerAccessInvoice ="
    );
    const customer = createInvoice.indexOf("stripe.customers.create");
    const invoice = createInvoice.indexOf("stripe.invoices.create");
    const item = createInvoice.indexOf("stripe.invoiceItems.create");
    const finalize = createInvoice.indexOf("stripe.invoices.finalizeInvoice");
    const send = createInvoice.indexOf("stripe.invoices.sendInvoice");
    expect(customer).toBeGreaterThan(-1);
    expect(invoice).toBeGreaterThan(customer);
    expect(item).toBeGreaterThan(invoice);
    expect(finalize).toBeGreaterThan(item);
    expect(send).toBeGreaterThan(finalize);
    expect(createInvoice).not.toContain("stripe.checkout.sessions");
    expect(createInvoice).not.toContain("payment_method_types");
  });

  test("supports only the four signed buyer Invoice events", () => {
    for (const eventType of [
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.voided",
      "invoice.marked_uncollectible"
    ]) {
      expect(BUYER_ACCESS_SOURCE).toContain('"' + eventType + '"');
    }
    expect(BUYER_ACCESS_SOURCE).not.toContain('"checkout.session.completed"');
    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain("Stripe.webhooks.constructEvent");
    expect(buyerWebhook).toContain("isBuyerAccessInvoice(invoice)");
    expect(buyerWebhook).toContain("buyerAccessProviderStateForEvent(event.type)");
    expect(buyerWebhook).toContain('res.status(400).send("Webhook verification failed.")');
    expect(buyerWebhook).not.toContain("err.message");
  });

  test("keeps buyer and quote webhook routing and deduplication separate", () => {
    const quoteWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.stripeWebhook =",
      "res.json({ received: true });\n});"
    );
    const guard = quoteWebhook.indexOf("if (isBuyerAccessStripeObject(session))");
    const dedupe = quoteWebhook.indexOf("stripe-${eventId}");
    expect(guard).toBeGreaterThan(-1);
    expect(dedupe).toBeGreaterThan(guard);
    expect(quoteWebhook).toContain(
      'ignored: "buyer_access_uses_dedicated_webhook"'
    );
    expect(quoteWebhook).not.toContain("processBuyerAccessInvoiceWebhook");

    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain('.doc("stripe-buyer-" + eventId)');
    expect(buyerWebhook).not.toContain("getStripeClient()");
  });

  test("paid settlement creates workspace and pending invite but no role or claims", () => {
    const provisioning = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function processBuyerAccessInvoiceWebhook",
      "exports.buyerAccessStripeWebhook ="
    );
    expect(provisioning).toContain("tx.create(orgRef");
    expect(provisioning).toContain("tx.create(settingsRef");
    expect(provisioning).toContain("tx.create(inviteRef");
    expect(provisioning).toContain("tx.create(provisioningOrderRef");
    expect(provisioning).toContain('status: "activation_pending"');
    expect(provisioning).toContain("workspaceReady: true");
    expect(provisioning).toContain("activationEmailSent: false");
    expect(provisioning).toContain("accessGranted: false");
    expect(provisioning).not.toContain("tx.create(roleRef");
    expect(provisioning).not.toContain("tx.set(roleRef");
    expect(provisioning).not.toContain("syncPrincipalClaims");
    expect(occurrenceCount(provisioning, "buyerAccessMode: BUYER_ACCESS_MODE"))
      .toBeGreaterThanOrEqual(1);
    expect(provisioning).toContain("buyerAccessOrderId: orderId");
  });

  test("durably finalizes onboarding email and preserves retryable activation pending", () => {
    const durableEmailFinalizer = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function finalizeProvisioningOrder",
      "async function sendOwnerSms"
    );
    expect(durableEmailFinalizer).toContain(
      'const failedAtISO = dispatchLease?.state === "acquired"'
    );
    expect(durableEmailFinalizer).toContain(
      ': existingFailedAtISO || completedAtISO;'
    );
    expect(durableEmailFinalizer).toContain("? { failedAtISO }");

    const finalization = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function finalizeBuyerAccessActivation",
      "async function processBuyerAccessInvoiceWebhook"
    );
    expect(finalization).toContain("await finalizeProvisioningOrder({");
    expect(finalization).toContain("requiresVerifiedSignIn: true");
    expect(finalization).toContain("finalized.emailResult?.sent === true");
    expect(finalization).toContain("finalized.emailResult?.auditPersisted === true");
    expect(finalization).toContain(
      'const nextStatus = activationEmailSent ? "activation_sent" : "activation_pending";'
    );
    const emailPayload = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function buildProvisioningEmailPayload",
      "function currencyLabel"
    );
    expect(emailPayload).toContain(
      "Complete the email verification message sent by Firebase"
    );
    expect(emailPayload).toContain(
      "Return to QuotePilot and sign in again with the verified email"
    );

    const status = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.getBuyerAccessInvoiceStatus =",
      "exports.createDepositCheckout ="
    );
    expect(status).toContain('order.status).toLowerCase() === "activation_pending"');
    expect(status).toContain("await finalizeBuyerAccessActivation");

    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain("result.shouldFinalizeActivation");
    expect(buyerWebhook).toContain("await finalizeBuyerAccessActivation");
    expect(buyerWebhook).toContain("res.json({ received: true, duplicate: true })");
  });

  test("verified bootstrap consumes once and safely resumes buyer claims completion", () => {
    const bootstrapInternal = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function ensureOrganizationBootstrapInternal",
      "async function getUserRole"
    );
    expect(bootstrapInternal).toContain("buyerAccessOrderId");
    expect(bootstrapInternal).toContain('status: "consumed"');
    expect(bootstrapInternal).toContain('status: "active"');
    expect(bootstrapInternal).toContain("accessGranted: true");
    expect(bootstrapInternal).toContain('claimsSyncStatus: "pending"');
    expect(bootstrapInternal).toContain("rolePayload.buyerAccessMode = BUYER_ACCESS_MODE");
    expect(bootstrapInternal).toContain("rolePayload.source = BUYER_ACCESS_FLOW");
    expect(bootstrapInternal).toContain("hasBuyerAccessRoleTag");
    expect(bootstrapInternal).toContain("roleBuyerAccessOrderId");
    expect(bootstrapInternal).toContain("resolveBuyerAccessBootstrapRecovery({");
    expect(bootstrapInternal).toContain(
      "buyerAccessOrderId: resolvedBuyerAccessOrderId"
    );

    const claimsCompletion = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function markBuyerAccessClaimsSyncSucceeded",
      "exports.ensureOrganizationBootstrap ="
    );
    expect(claimsCompletion).toContain("const claimsUser = await auth.getUser");
    expect(claimsCompletion).toContain("await db.runTransaction(async (tx)");
    expect(claimsCompletion).toContain("resolveBuyerAccessBootstrapRecovery({");
    expect(claimsCompletion).toContain('claimsSyncStatus: "succeeded"');

    const bootstrap = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.ensureOrganizationBootstrap =",
      "async function resolveCustomerProvisioningRequest"
    );
    const internalCall = bootstrap.indexOf("ensureOrganizationBootstrapInternal");
    const claimsSync = bootstrap.indexOf("await syncPrincipalClaims");
    expect(internalCall).toBeGreaterThan(-1);
    expect(claimsSync).toBeGreaterThan(internalCall);
    expect(bootstrap).toContain(
      "rejectOrganizationReassignment: Boolean(bootstrap.buyerAccessOrderId)"
    );
    expect(bootstrap).toContain("await markBuyerAccessClaimsSyncSucceeded({");
    expect(bootstrap).not.toContain(
      ".doc(bootstrap.buyerAccessOrderId)\n      .set("
    );
  });

  test("uses generic public conflict/status errors and privacy-minimal audit fields", () => {
    expect(occurrenceCount(
      FUNCTIONS_INDEX_SOURCE,
      '"Buyer access status is unavailable."'
    )).toBe(2);
    expect(occurrenceCount(
      FUNCTIONS_INDEX_SOURCE,
      '"Buyer access request cannot be completed."'
    )).toBeGreaterThanOrEqual(4);

    const audit = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function buyerAccessWebhookAudit",
      "async function recordIgnoredBuyerAccessWebhook"
    );
    expect(audit).not.toContain("ownerEmail");
    expect(audit).not.toContain("ownerUid");
    expect(audit).not.toContain("requestIp");

    const emailSend = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function sendCustomerEmail",
      "function provisioningCompletionStatus"
    );
    const failureLog = sourceBetween(
      emailSend,
      'functions.logger.error("Customer email send failed"',
      "const classification ="
    );
    expect(failureLog).toContain('operation: "transactional_email"');
    expect(failureLog).toContain("errorCode:");
    expect(failureLog).not.toContain("to,");
    expect(failureLog).not.toContain("subject:");
    expect(failureLog).not.toContain("error?.message");
  });
});
