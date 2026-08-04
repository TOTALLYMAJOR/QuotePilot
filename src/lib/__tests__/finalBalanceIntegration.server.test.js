import { createRequire } from "node:module";
import fs from "node:fs";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { finalBalanceStoredState } = require("../../../functions/finalBalancePayment.js");

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

test("keeps final-balance checkout on the shared server-authoritative Stripe rail", () => {
  const sendWrappers = sourceBetween(
    "exports.sendPaymentRequestEmail =",
    "exports.getIntegrationSetupStatus ="
  );
  expect(sendWrappers).toMatch(
    /exports\.sendPaymentRequestEmail\s*=\s*[\s\S]{0,180}sendApprovedPaymentRequestEmail\(\s*data,\s*context,\s*"deposit"\s*\)/
  );
  expect(sendWrappers).toMatch(
    /exports\.sendFinalBalanceRequestEmail\s*=\s*[\s\S]{0,180}sendApprovedPaymentRequestEmail\(\s*data,\s*context,\s*"final_balance"\s*\)/
  );

  const reconcileWrappers = sourceBetween(
    "exports.reconcileDepositCheckout =",
    "exports.createDepositCheckout ="
  );
  expect(reconcileWrappers).toMatch(
    /exports\.reconcileDepositCheckout\s*=\s*[\s\S]{0,180}reconcileCheckout\(\s*data,\s*context,\s*"deposit"\s*\)/
  );
  expect(reconcileWrappers).toMatch(
    /exports\.reconcileFinalBalanceCheckout\s*=\s*[\s\S]{0,180}reconcileCheckout\(\s*data,\s*context,\s*"final_balance"\s*\)/
  );

  const sharedSend = sourceBetween(
    "async function sendApprovedPaymentRequestEmail",
    "exports.sendPaymentRequestEmail ="
  );
  expect(sharedSend).toMatch(
    /data\?\.amountCents\s*!=\s*null[\s\S]{0,180}data\?\.paymentKind\s*!=\s*null/
  );
  expect(sharedSend).toContain(
    "Payment amount, currency, kind, and checkout generation are server-derived."
  );
  expect(sharedSend).toMatch(
    /const hasPersistedCheckoutPreparation = Boolean\(\s*executionSnap\.exists\s*&&\s*executionSnap\.data\(\)\?\.checkoutPreparation\s*\)/
  );
  expect(sharedSend).toContain(
    "reuseCurrentCheckoutGeneration: hasPersistedCheckoutPreparation"
  );
  expect(sharedSend).toMatch(
    /allowSettled:\s*true,\s*allowExpiredPortal:\s*paymentPortalExpired,\s*reuseCurrentCheckoutGeneration:\s*true/
  );
  expect(sharedSend).not.toMatch(
    /reuseCurrentCheckoutGeneration:\s*executionSnap\.exists/
  );
  expect(sharedSend).toContain(
    "allowExpiredPortal: hasPersistedCheckoutPreparation"
  );
  const restoredPreparation = sharedSend.indexOf(
    "checkoutPreparation = await restoreApprovedCheckoutPreparation"
  );
  const expiredPortalGuard = sharedSend.indexOf("if (\n      paymentPortalExpired");
  const dispatchClaim = sharedSend.indexOf("await claimPaymentDispatchAttempt");
  expect(restoredPreparation).toBeGreaterThan(-1);
  expect(expiredPortalGuard).toBeGreaterThan(restoredPreparation);
  expect(dispatchClaim).toBeGreaterThan(expiredPortalGuard);
  expect(sharedSend.slice(expiredPortalGuard, dispatchClaim)).toContain(
    'paymentDispatch?.state).toLowerCase() !== "provider_accepted"'
  );
  expect(sharedSend).toContain(
    "allowExpiredPortal: paymentPortalExpired"
  );
  const expiredPortalRecovery = sourceBetween(
    "async function finalizeExpiredPortalAmbiguousDispatch",
    "async function finalizeUnpreparedPaymentExecutionFailure"
  );
  expect(expiredPortalRecovery).toContain(
    'if (dispatch.state !== "recovery_claimed") return null;'
  );
  expect(expiredPortalRecovery).toContain('emailProviderOutcome: "unknown"');
  expect(expiredPortalRecovery).toContain("mapStripeCheckoutReconciliation(stripeSession)");
  expect(expiredPortalRecovery).toContain(
    "await stripe.checkout.sessions.expire(preparation.stripeSessionId)"
  );
  expect(expiredPortalRecovery).toContain('state: "failed"');
  expect(expiredPortalRecovery).toContain(
    'currentPayment.depositStatus === "refunded"'
  );
  expect(expiredPortalRecovery).toContain(
    'portalProjectionState = "identity_mismatch"'
  );
  expect(expiredPortalRecovery).toContain(
    'if (paymentChanged && portalProjectionState === "ready")'
  );
  const portalRead = expiredPortalRecovery.indexOf("await tx.get(portalRef)");
  const firstWrite = Math.min(
    ...["tx.update(quoteRef", "tx.set(executionRef", "tx.set(portalRef"]
      .map((marker) => expiredPortalRecovery.indexOf(marker))
      .filter((index) => index >= 0)
  );
  expect(portalRead).toBeGreaterThan(-1);
  expect(firstWrite).toBeGreaterThan(portalRead);
  const recoveryClaim = sourceBetween(
    "async function claimExpiredPortalPaymentDispatchRecovery",
    "async function readQuoteOrThrow"
  );
  expect(recoveryClaim).toContain(
    "planExpiredPortalPaymentDispatchRecovery({"
  );
  expect(recoveryClaim).toContain(
    "staleAfterMs: PAYMENT_DISPATCH_RECOVERY_STALE_MS"
  );
  expect(recoveryClaim).toContain("paymentDispatch: plan.dispatch");
  const dispatchStateSource = fs.readFileSync(
    new URL("../../../functions/paymentDispatchState.js", import.meta.url),
    "utf8"
  );
  expect(dispatchStateSource).toContain('RECOVERY_CLAIMED: "recovery_claimed"');
  expect(dispatchStateSource).toContain(
    'action: "expired_portal_recovery_in_progress"'
  );
  expect(dispatchStateSource).toContain(
    'state: PAYMENT_DISPATCH_STATES.RECOVERY_CLAIMED'
  );
  const unknownDispatchBranch = sharedSend.indexOf(
    "const expiredPortalUnknownDispatch = Boolean("
  );
  const recoveryClaimCall = sharedSend.indexOf(
    "await claimExpiredPortalPaymentDispatchRecovery",
    unknownDispatchBranch
  );
  const checkoutRecoveryCall = sharedSend.indexOf(
    "await finalizeExpiredPortalAmbiguousDispatch",
    unknownDispatchBranch
  );
  const genericDispatchFailure = sharedSend.indexOf(
    "dispatchFailurePlan = await recordPaymentDispatchFailure"
  );
  expect(unknownDispatchBranch).toBeGreaterThan(-1);
  expect(sharedSend.slice(unknownDispatchBranch, recoveryClaimCall)).toContain(
    '"recovery_claimed"'
  );
  expect(recoveryClaimCall).toBeGreaterThan(unknownDispatchBranch);
  expect(checkoutRecoveryCall).toBeGreaterThan(recoveryClaimCall);
  expect(genericDispatchFailure).toBeGreaterThan(unknownDispatchBranch);

  const finalBalanceScope = sourceBetween(
    "function deriveFinalBalanceRequestApprovalScope",
    "function deriveApprovedPaymentRequestScope"
  );
  expect(finalBalanceScope).toContain(
    "if (!finalSettled && !reuseCurrentCheckoutGeneration)"
  );

  const sharedReconcile = sourceBetween(
    "async function reconcileCheckout",
    "exports.reconcileDepositCheckout ="
  );
  expect(sharedReconcile).toMatch(
    /data\?\.amountCents\s*!=\s*null[\s\S]{0,120}data\?\.paymentKind\s*!=\s*null/
  );
  expect(sharedReconcile).toContain(
    "Reconciliation payment identity and amount are server-derived."
  );

  const checkoutPreparation = sourceBetween(
    "async function prepareCheckoutForApprovedSend",
    "async function reconcileCheckout"
  );
  expect(checkoutPreparation).toMatch(
    /metadata:\s*\{[\s\S]{0,700}paymentKind:\s*flow\.paymentKind/
  );
  expect(checkoutPreparation).toMatch(
    /idempotencyKey:\s*buildStripeCheckoutIdempotencyKey\(\{[\s\S]{0,500}paymentKind:\s*flow\.paymentKind/
  );

  const webhook = sourceBetween(
    "exports.stripeWebhook =",
    "res.json({ received: true });\n});"
  );
  const metadataKind = webhook.search(
    /const paymentKind\s*=\s*normalizeText\(session\?\.metadata\?\.paymentKind\)\.toLowerCase\(\)\s*\|\|\s*"deposit"/
  );
  const selectedFlow = webhook.search(/flow\s*=\s*getPaymentRequestFlow\(paymentKind\)/);
  const selectedPayment = webhook.search(
    /checkoutPaymentForQuote\(quote,\s*flow\.paymentKind\)/
  );
  const patchedPayment = webhook.search(
    /patchPaymentState\(\{[\s\S]{0,700}paymentKind:\s*flow\.paymentKind/
  );
  expect(metadataKind).toBeGreaterThan(-1);
  expect(selectedFlow).toBeGreaterThan(metadataKind);
  expect(selectedPayment).toBeGreaterThan(selectedFlow);
  expect(patchedPayment).toBeGreaterThan(selectedPayment);

  const portalProjection = sourceBetween(
    "function portalPaymentState",
    "function escapeHtml"
  );
  expect(portalProjection).toMatch(
    /if\s*\(paymentKind\s*===\s*"final_balance"\)\s*\{[\s\S]{0,240}stripeSessionId:\s*_stripeSessionId,[\s\S]{0,120}knownStripeSessionIds:\s*_knownStripeSessionIds,[\s\S]{0,120}return\s*\{\s*finalBalance:\s*customerSafe\s*};/
  );

  const paymentPatch = sourceBetween(
    "async function patchPaymentState",
    "function isAmbiguousStripeProviderError"
  );
  const operationIdentity = paymentPatch.indexOf(
    "const operationId = shouldUpdatePayment"
  );
  const quotePaymentUpdate = paymentPatch.indexOf("if (shouldUpdatePayment)");
  const portalPaymentUpdate = paymentPatch.indexOf(
    "if (portalRef && shouldUpdatePayment)"
  );
  expect(operationIdentity).toBeGreaterThan(-1);
  expect(quotePaymentUpdate).toBeGreaterThan(operationIdentity);
  expect(portalPaymentUpdate).toBeGreaterThan(quotePaymentUpdate);

  const storedFinalBalance = finalBalanceStoredState({
    depositStatus: "sent",
    depositLink: "https://checkout.stripe.com/c/pay/cs_test_final_balance",
    stripeSessionId: "cs_test_final_balance",
    stripeCheckoutState: "open",
    checkoutGeneration: 1,
    knownStripeSessionIds: ["cs_test_final_balance"],
    operationId: "approval-private-final-balance"
  }, {
    amountCents: 12_500,
    currency: "usd"
  });
  expect(storedFinalBalance).not.toHaveProperty("operationId");
});
