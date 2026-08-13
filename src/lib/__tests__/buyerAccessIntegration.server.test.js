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
const FIRESTORE_INDEXES = JSON.parse(fs.readFileSync(
  new URL("../../../firestore.indexes.json", import.meta.url),
  "utf8"
));

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

function exportedFunctionSource(name) {
  const marker = `exports.${name} =`;
  const start = FUNCTIONS_INDEX_SOURCE.indexOf(marker);
  if (start < 0) throw new Error(`Unable to locate ${marker}.`);
  const next = FUNCTIONS_INDEX_SOURCE.indexOf("\nexports.", start + marker.length);
  return FUNCTIONS_INDEX_SOURCE.slice(start, next < 0 ? undefined : next);
}

describe("buyer access Invoice endpoint isolation", () => {
  test("declares the buyer rate-limit expiry TTL in deployable Firestore configuration", () => {
    const buyerRateLimitOverrides = FIRESTORE_INDEXES.fieldOverrides.filter(
      (field) => field.collectionGroup === "buyerAccessRateLimits"
        && field.fieldPath === "expiresAt"
    );
    expect(buyerRateLimitOverrides).toEqual([{
      collectionGroup: "buyerAccessRateLimits",
      fieldPath: "expiresAt",
      ttl: true,
      indexes: []
    }]);
  });

  test("binds least-privilege secrets to public create and dedicated webhook endpoints", () => {
    const create = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.createBuyerAccessInvoice =",
      "exports.getBuyerAccessInvoiceStatus ="
    );
    expect(create).toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(create).toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");
    expect(create).toContain("BUYER_ACCESS_RATE_LIMIT_SECRET_NAME");
    expect(create).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");

    const status = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.getBuyerAccessInvoiceStatus =",
      "exports.createDepositCheckout ="
    );
    expect(status).not.toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(status).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");
    expect(status).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");
    expect(status).toContain("BUYER_ACCESS_RATE_LIMIT_SECRET_NAME");
    expect(status).toContain("RESEND_API_KEY_SECRET_NAME");

    const buyerWebhook = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.buyerAccessStripeWebhook =",
      "exports.stripeWebhook ="
    );
    expect(buyerWebhook).toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");
    expect(buyerWebhook).toContain("RESEND_API_KEY_SECRET_NAME");
    expect(buyerWebhook).not.toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(buyerWebhook).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");

    const repair = exportedFunctionSource("repairBuyerAccessInvoice");
    expect(repair).toContain("BUYER_ACCESS_STRIPE_SECRET_NAME");
    expect(repair).not.toContain("BUYER_ACCESS_STRIPE_WEBHOOK_SECRET_NAME");
    expect(repair).not.toContain("BUYER_ACCESS_TURNSTILE_SECRET_NAME");
    expect(repair).not.toContain("BUYER_ACCESS_RATE_LIMIT_SECRET_NAME");
    expect(repair).not.toContain("RESEND_API_KEY_SECRET_NAME");
  });

  test("binds generic provider secrets only to their complete call graph", () => {
    const expected = {
      provisionCustomerOrder: ["RESEND_API_KEY_SECRET_NAME"],
      repairCustomerProvisioningOrder: ["RESEND_API_KEY_SECRET_NAME"],
      sendQuoteToCustomer: ["RESEND_API_KEY_SECRET_NAME"],
      sendPaymentRequestEmail: ["STRIPE_SECRET_NAME", "RESEND_API_KEY_SECRET_NAME"],
      sendFinalBalanceRequestEmail: ["STRIPE_SECRET_NAME", "RESEND_API_KEY_SECRET_NAME"],
      getIntegrationSetupStatus: [
        "STRIPE_SECRET_NAME",
        "STRIPE_WEBHOOK_SECRET_NAME",
        "RESEND_API_KEY_SECRET_NAME"
      ],
      reconcileDepositCheckout: ["STRIPE_SECRET_NAME"],
      reconcileFinalBalanceCheckout: ["STRIPE_SECRET_NAME"],
      stripeWebhook: ["STRIPE_WEBHOOK_SECRET_NAME"]
    };
    const genericNames = [
      "STRIPE_SECRET_NAME",
      "STRIPE_WEBHOOK_SECRET_NAME",
      "RESEND_API_KEY_SECRET_NAME"
    ];
    for (const [exportName, expectedNames] of Object.entries(expected)) {
      const source = exportedFunctionSource(exportName);
      expect(source, exportName).toContain(".runWith({");
      for (const secretName of genericNames) {
        if (expectedNames.includes(secretName)) {
          expect(source, `${exportName}:${secretName}`).toContain(secretName);
        } else {
          expect(source, `${exportName}:${secretName}`).not.toContain(secretName);
        }
      }
    }

    const smsTest = exportedFunctionSource("sendIntegrationTestSms");
    expect(smsTest).not.toContain(".runWith({");
    for (const secretName of [
      ...genericNames,
      "TWILIO_AUTH_TOKEN_SECRET_NAME",
      "PINGRAM_API_KEY_SECRET_NAME",
      "PINGRAM_WEBHOOK_SECRET_NAME",
      "SMS_CONTACT_DIGEST_SECRET_NAME"
    ]) {
      expect(smsTest, `sendIntegrationTestSms:${secretName}`).not.toContain(secretName);
    }

    expect(FUNCTIONS_INDEX_SOURCE).not.toContain('readConfig("stripe.secret_key")');
    expect(FUNCTIONS_INDEX_SOURCE).not.toContain('readConfig("stripe.webhook_secret")');
    expect(FUNCTIONS_INDEX_SOURCE).not.toContain('readConfig("resend.api_key")');
    const genericWebhook = exportedFunctionSource("stripeWebhook");
    expect(genericWebhook).toContain("constructStripeWebhookEvent({");
    expect(genericWebhook).not.toContain("getStripeClient()");
    expect(genericWebhook).toContain('res.status(400).send("Webhook verification failed.")');
    expect(genericWebhook).not.toContain("err.message");
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

  test("reserves a durable create lease after Turnstile and before every identity or order lookup", () => {
    const create = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.createBuyerAccessInvoice =",
      "exports.getBuyerAccessInvoiceStatus ="
    );
    const turnstile = create.indexOf("await verifyBuyerAccessTurnstile({");
    const reservation = create.indexOf("await reservePublicBuyerAccessCreation({");
    const identity = create.indexOf("await assertPublicBuyerIdentityAvailable");
    const order = create.indexOf("await preparePublicBuyerAccessOrder({");
    expect(turnstile).toBeGreaterThan(-1);
    expect(reservation).toBeGreaterThan(turnstile);
    expect(identity).toBeGreaterThan(reservation);
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

    const reservationSource = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function reservePublicBuyerAccessCreation",
      "async function consumeBuyerAccessStatusRateLimit"
    );
    expect(reservationSource).toContain("await db.runTransaction(async (tx)");
    expect(reservationSource).toContain("const reservationSnap = await tx.get(reservationRef)");
    expect(reservationSource).toContain("return { identifiers, reused: true }");
    expect(reservationSource).toContain("planBuyerAccessCreationReservation({");
    expect(reservationSource).toContain("tx.set(ipRateRef");
    expect(reservationSource).toContain("if (reservation.reused)");
    expect(reservationSource).toContain("tx.set(reservationRef");
    expect(reservationSource).toContain("expiresAt: Timestamp.fromDate(");
    expect(reservationSource).not.toContain("assertPublicBuyerIdentityAvailable");
  });

  test("allows only the exact loopback app route to use HTTP in the Functions emulator", () => {
    const appUrl = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getBuyerAccessApplicationUrl",
      "async function finalizeBuyerAccessActivation"
    );
    expect(appUrl).toContain('process.env.FUNCTIONS_EMULATOR === "true"');
    expect(appUrl).toContain('parsed.protocol === "http:"');
    expect(appUrl).toContain('["localhost", "127.0.0.1"].includes(parsed.hostname)');
    expect(appUrl).toContain('=== "/app"');
    expect(appUrl).toContain('(parsed.protocol !== "https:" && !isLoopbackEmulatorUrl)');
  });

  test("uses trusted request IP seams and secret-keyed rolling-window rate documents", () => {
    const trustedIp = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getTrustedBuyerAccessRequestIp",
      "function buyerAccessRateLimitDocumentIds"
    );
    expect(trustedIp).toContain("context?.rawRequest?.ip");
    expect(trustedIp).toContain("context?.rawRequest?.socket?.remoteAddress");
    expect(trustedIp).toContain('process.env.FUNCTIONS_EMULATOR === "true"');
    expect(trustedIp).toContain('? "127.0.0.1" : ""');
    expect(trustedIp.toLowerCase()).not.toContain("x-forwarded-for");

    const rateLimitConfig = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function getBuyerAccessRateLimitSecret",
      "function buyerAccessRateLimitDocumentIds"
    );
    expect(rateLimitConfig).toContain('readEnvConfig("buyer_access_rate_limit_secret")');
    expect(rateLimitConfig).not.toContain('readConfig("buyer_access_rate_limit_secret")');

    const rateLimitIds = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "function buyerAccessRateLimitDocumentIds",
      "async function consumeBuyerAccessStatusRateLimit"
    );
    expect(rateLimitIds).toContain("buyerAccessRateLimitDocumentId({");
    expect(rateLimitIds).toContain('scope: "invoice_ip"');
    expect(rateLimitIds).toContain('scope: "invoice_email"');
    expect(rateLimitIds).toContain('scope: "invoice_reservation"');
    expect(rateLimitIds).toContain('scope: "status_ip"');

    const hmac = sourceBetween(
      BUYER_ACCESS_SOURCE,
      "function buyerAccessRateLimitDocumentId",
      "function planBuyerAccessRateLimit"
    );
    expect(hmac).toContain('createHmac("sha256", secret)');
    expect(hmac).not.toContain("createHash(");

    const rateLimits = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function consumeBuyerAccessStatusRateLimit",
      "async function verifyBuyerAccessTurnstile"
    );
    expect(rateLimits).toContain("await db.runTransaction(async (tx)");
    expect(rateLimits).toContain("BUYER_ACCESS_STATUS_RATE_LIMIT");
    expect(rateLimits).toContain("BUYER_ACCESS_STATUS_RATE_WINDOW_MS");
    expect(rateLimits).toContain("expiresAt: Timestamp.fromMillis(rate.expiresAtMs)");
    expect(rateLimits).toContain('scope: "status_ip_5m"');
    expect(rateLimits).toContain('"unavailable"');
    const persistedPatch = sourceBetween(
      rateLimits,
      "tx.set(rateRef, {",
      "}, { merge: true });"
    );
    expect(persistedPatch).not.toContain("requestIp");
    expect(persistedPatch).not.toContain("ownerEmail");
  });

  test("consumes a durable status lease before unknown-order and token-bound reads", () => {
    const authorization = sourceBetween(
      BUYER_ACCESS_SOURCE,
      "async function authorizeBuyerAccessStatusRequest",
      "function buyerAccessStatusTokenMatches"
    );
    const rate = authorization.indexOf("await consumeRateLimit()");
    const read = authorization.indexOf("await readOrder(normalizedInput.orderId)");
    const token = authorization.indexOf("buyerAccessStatusTokenMatches({");
    expect(rate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(rate);
    expect(token).toBeGreaterThan(read);

    const status = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "exports.getBuyerAccessInvoiceStatus =",
      "exports.createDepositCheckout ="
    );
    expect(status).toContain(".https.onCall(async (data, context) =>");
    expect(status).toContain(
      "consumeRateLimit: () => consumeBuyerAccessStatusRateLimit(context)"
    );
    expect(status).toContain("readOrder: async (orderId) =>");
    expect(status).toContain("await finalizeBuyerAccessActivation");
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
    expect(buyerWebhook).toContain("constructStripeWebhookEvent({");
    expect(buyerWebhook).toContain("isBuyerAccessInvoice(invoice)");
    expect(buyerWebhook).toContain("buyerAccessProviderStateForEvent(event.type)");
    expect(buyerWebhook).toContain('res.status(400).send("Webhook verification failed.")');
    expect(buyerWebhook).not.toContain("err.message");
  });

  test("keeps buyer and quote webhook routing and deduplication separate", () => {
    const quoteWebhook = exportedFunctionSource("stripeWebhook");
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

  test("requires verified provider-void evidence for replacement and ignores superseded late payment", () => {
    expect(BUYER_ACCESS_SOURCE).toContain("function hasBuyerAccessReissuableVoidEvidence");
    expect(BUYER_ACCESS_SOURCE).toContain("order.signedVoidObserved === true");
    expect(BUYER_ACCESS_SOURCE).toContain("order.operatorVoidObserved === true");
    expect(BUYER_ACCESS_SOURCE).toContain('lastProviderObservationSource) === "admin_reconciliation"');
    const preparation = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function preparePublicBuyerAccessOrder",
      "async function persistBuyerAccessProviderStep"
    );
    expect(preparation).toContain('.where("ownerEmail", "=="');
    expect(preparation).toContain("!hasBuyerAccessReissuableVoidEvidence");
    expect(preparation).toContain("supersededByOrderId: identifiers.orderId");
    expect(preparation).toContain('"Buyer access request cannot be completed."');

    const processing = sourceBetween(
      FUNCTIONS_INDEX_SOURCE,
      "async function processBuyerAccessInvoiceWebhook",
      "exports.buyerAccessStripeWebhook ="
    );
    const initialSupersession = processing.indexOf(
      "if (normalizeText(initialOrder.supersededByOrderId))"
    );
    const identityLookup = processing.indexOf(
      "await assertPublicBuyerIdentityAvailable(initialOrder.ownerEmail)"
    );
    expect(initialSupersession).toBeGreaterThan(-1);
    expect(identityLookup).toBeGreaterThan(initialSupersession);
    expect(processing).toContain('result: "superseded_order"');
    expect(processing).toContain("if (normalizeText(order.supersededByOrderId))");
    expect(processing).toContain('ignored: "superseded_order"');
    expect(processing).toContain('signedVoidObserved: providerState === "void"');

    const repair = exportedFunctionSource("repairBuyerAccessInvoice");
    expect(repair).toContain("staff.role !== \"admin\" || !staff.platformAdmin");
    expect(repair).toContain("normalizeBuyerAccessRepairRequest(data)");
    expect(repair).toContain("stripe.invoices.retrieve");
    expect(repair).toContain("stripe.invoices.voidInvoice");
    expect(repair).toContain("assertBuyerAccessRepairArtifactsAbsent(order)");
    expect(repair).toContain("tx.create(auditRef");
    expect(repair).toContain('source: "admin_reconciliation"');
    expect(repair).toContain("operatorVoidObserved: true");
    expect(repair).not.toContain("hostedInvoiceUrl: invoice");
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
      "function ownerSmsDocumentHash"
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
      FUNCTIONS_INDEX_SOURCE + BUYER_ACCESS_SOURCE,
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
