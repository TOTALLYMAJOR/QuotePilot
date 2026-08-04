import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  PaymentDispatchStateError,
  beginPaymentDispatchAttempt,
  classifyPaymentDispatchError,
  planPaymentDispatchFailure,
  planPaymentDispatchResume,
  recordPaymentDispatchProviderAcceptance
} = require("../../../functions/paymentDispatchState.js");
const {
  assertPreparedCheckoutPublicationTransition,
  buildPreparedCheckoutState,
  buildPublishedCheckoutState
} = require("../../../functions/paymentSafety.js");

const FUNCTIONS_INDEX_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);

function callableSource(name, nextName) {
  const start = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${name} =`);
  const end = FUNCTIONS_INDEX_SOURCE.indexOf(`exports.${nextName} =`, start + 1);
  return FUNCTIONS_INDEX_SOURCE.slice(start, end);
}

const NOW = "2026-08-04T15:00:00.000Z";
const LATER = "2026-08-04T15:01:00.000Z";
const identity = {
  operationId: "approval-request-1",
  actorUid: "admin-uid-1",
  actionScopeDigest: "a".repeat(64),
  idempotencyKey: "quote-approval/org-a/quote-1/approval-request-1"
};

function start() {
  return beginPaymentDispatchAttempt({
    ...identity,
    nowISO: NOW
  });
}

function providerError(message, fields = {}) {
  return Object.assign(new Error(message), fields);
}

describe("payment dispatch state", () => {
  test.each([
    ["network ambiguity", providerError("fetch failed", {
      paymentDispatchOutcome: "ambiguous",
      paymentDispatchReason: "provider_network_error"
    })],
    ["HTTP 202 without a message id", providerError("missing id", {
      providerHttpStatus: 202,
      paymentDispatchReason: "provider_2xx_missing_message_id"
    })],
    ["HTTP 408", providerError("timeout", { providerHttpStatus: 408 })],
    ["HTTP 409", providerError("conflict", { providerHttpStatus: 409 })],
    ["HTTP 429", providerError("rate limit", { providerHttpStatus: 429 })],
    ["HTTP 503", providerError("unavailable", { providerHttpStatus: 503 })],
    ["unknown provider outcome", providerError("socket closed")]
  ])("keeps %s in progress without neutralizing its checkout", (_label, error) => {
    const plan = planPaymentDispatchFailure({
      dispatch: start(),
      error,
      nowISO: LATER
    });

    expect(plan).toMatchObject({
      outcome: "ambiguous",
      executionState: "in_progress",
      resumable: true,
      nextAction: "retry_provider_with_same_key",
      shouldNeutralizeCheckout: false,
      shouldAdvanceCheckoutGeneration: false,
      requiresNewApproval: false,
      dispatch: {
        state: "outcome_ambiguous",
        idempotencyKey: identity.idempotencyKey,
        completedAtISO: ""
      }
    });
  });

  test.each([
    ["HTTP 400", providerError("invalid recipient", { providerHttpStatus: 400 })],
    ["HTTP 422", providerError("validation failed", { providerHttpStatus: 422 })],
    ["local configuration", providerError("provider disabled", {
      code: "failed-precondition"
    })],
    ["explicit provider rejection", providerError("rejected", {
      paymentDispatchOutcome: "definite_failure",
      paymentDispatchReason: "provider_rejected"
    })]
  ])("fails %s and permits checkout neutralization", (_label, error) => {
    const plan = planPaymentDispatchFailure({
      dispatch: start(),
      error,
      nowISO: LATER
    });

    expect(plan).toMatchObject({
      outcome: "definite_failure",
      executionState: "failed",
      resumable: false,
      nextAction: "new_approval_required",
      shouldNeutralizeCheckout: true,
      shouldAdvanceCheckoutGeneration: true,
      requiresNewApproval: true,
      dispatch: {
        state: "definite_failure",
        completedAtISO: LATER
      }
    });
  });

  test("retries an ambiguous attempt with the exact same provider key", () => {
    const ambiguous = planPaymentDispatchFailure({
      dispatch: start(),
      error: providerError("fetch failed", {
        paymentDispatchOutcome: "ambiguous",
        paymentDispatchReason: "provider_network_error"
      }),
      nowISO: LATER
    });
    const resume = planPaymentDispatchResume({
      executionState: ambiguous.executionState,
      dispatch: ambiguous.dispatch,
      ...identity
    });
    expect(resume).toEqual({
      action: "retry_provider_with_same_key",
      resumable: true,
      idempotencyKey: identity.idempotencyKey
    });

    const retry = beginPaymentDispatchAttempt({
      dispatch: ambiguous.dispatch,
      ...identity,
      nowISO: "2026-08-04T15:02:00.000Z"
    });
    expect(retry).toMatchObject({
      state: "sending",
      attemptCount: 2,
      startedAtISO: NOW,
      lastAttemptAtISO: "2026-08-04T15:02:00.000Z",
      idempotencyKey: identity.idempotencyKey
    });
  });

  test("persists provider acceptance as publication-only resumable work", () => {
    const accepted = recordPaymentDispatchProviderAcceptance({
      dispatch: start(),
      provider: "resend",
      providerMessageId: "email-message-1",
      nowISO: LATER
    });
    expect(accepted).toMatchObject({
      executionState: "in_progress",
      resumable: true,
      nextAction: "complete_publication",
      shouldNeutralizeCheckout: false,
      dispatch: {
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "email-message-1",
        providerAcceptedAtISO: LATER
      }
    });
    expect(planPaymentDispatchResume({
      executionState: accepted.executionState,
      dispatch: accepted.dispatch,
      ...identity
    })).toEqual({
      action: "complete_publication",
      resumable: true,
      idempotencyKey: identity.idempotencyKey,
      provider: "resend",
      providerMessageId: "email-message-1"
    });
    expect(() => beginPaymentDispatchAttempt({
      dispatch: accepted.dispatch,
      ...identity,
      nowISO: "2026-08-04T15:02:00.000Z"
    })).toThrowError(/finish publication without sending again/i);
  });

  test("recovers one prepared checkout through provider acceptance and idempotent publication", () => {
    const preparedPayment = buildPreparedCheckoutState({
      expectedPayment: {
        depositStatus: "unpaid",
        depositLink: "",
        depositConfirmedAtISO: "",
        stripeSessionId: "",
        stripeCheckoutState: "",
        checkoutGeneration: 0,
        knownStripeSessionIds: []
      },
      stripeSessionId: "cs_test_combined_recovery",
      checkoutGeneration: 1
    });
    const publishedPayment = buildPublishedCheckoutState({
      preparedPayment,
      depositLink: "https://checkout.stripe.com/c/pay/combined-recovery"
    });
    const accepted = recordPaymentDispatchProviderAcceptance({
      dispatch: start(),
      provider: "resend",
      providerMessageId: "email-combined-recovery",
      nowISO: LATER
    });

    expect(planPaymentDispatchResume({
      executionState: accepted.executionState,
      dispatch: accepted.dispatch,
      ...identity
    })).toMatchObject({
      action: "complete_publication",
      provider: "resend",
      providerMessageId: "email-combined-recovery"
    });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: preparedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: false });
    expect(assertPreparedCheckoutPublicationTransition({
      currentPayment: publishedPayment,
      expectedPreparedPayment: preparedPayment,
      publishedPayment
    })).toEqual({ alreadyApplied: true });
  });

  test("wires publication-only recovery ahead of any second provider email", () => {
    const source = callableSource("sendPaymentRequestEmail", "getIntegrationSetupStatus");
    const recoveryBranch = source.indexOf(
      'if (dispatchAttempt.action === "complete_publication")'
    );
    const providerSend = source.indexOf("email = await sendCustomerEmail");
    const acceptanceRecord = source.indexOf(
      "paymentDispatch = await recordPaymentDispatchAcceptance"
    );
    const publication = source.indexOf("const completed = await db.runTransaction");

    expect(recoveryBranch).toBeGreaterThan(-1);
    expect(providerSend).toBeGreaterThan(recoveryBranch);
    expect(acceptanceRecord).toBeGreaterThan(providerSend);
    expect(publication).toBeGreaterThan(acceptanceRecord);
    const recoveryPath = source.slice(recoveryBranch, providerSend);
    expect(recoveryPath).toContain("providerAccepted = true");
    expect(recoveryPath).not.toContain("await sendCustomerEmail");
  });

  test("redacts every nested checkout URL before writing the readable execution audit", () => {
    const redactionStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function redactCheckoutPreparation"
    );
    const redactionEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function restorePrivateCheckoutPreparation",
      redactionStart
    );
    const redactionSource = FUNCTIONS_INDEX_SOURCE.slice(redactionStart, redactionEnd);
    const persistenceStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function persistApprovedCheckoutPreparation"
    );
    const persistenceEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function prepareDepositCheckoutForApprovedSend",
      persistenceStart
    );
    const persistenceSource = FUNCTIONS_INDEX_SOURCE.slice(
      persistenceStart,
      persistenceEnd
    );

    expect(redactionStart).toBeGreaterThan(-1);
    expect(redactionSource).toContain("privateDepositLink: _privateDepositLink");
    expect(redactionSource).toContain("url: _url");
    expect(redactionSource).toContain('depositLink: ""');
    for (const field of ["expectedPayment", "preparedPayment", "publishedPayment"]) {
      expect(redactionSource).toContain(
        `${field}: redactPaymentLink(safePreparation.${field})`
      );
    }
    expect(persistenceSource).toContain(
      "checkoutPreparation: redactCheckoutPreparation(preparation)"
    );
    expect(persistenceSource).toContain(
      "privateDepositLink: preparation.privateDepositLink"
    );
  });

  test("keeps post-create and preparation-persistence uncertainty resumable", () => {
    const callable = callableSource("sendPaymentRequestEmail", "getIntegrationSetupStatus");
    const preparationStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function prepareDepositCheckoutForApprovedSend"
    );
    const preparationEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "exports.reconcileDepositCheckout =",
      preparationStart
    );
    const preparationSource = FUNCTIONS_INDEX_SOURCE.slice(
      preparationStart,
      preparationEnd
    );

    expect(callable).toContain("await persistApprovedCheckoutPreparation");
    expect(callable).toContain("await recoverPersistedApprovedCheckoutPreparation");
    expect(callable).toContain("checkout_preparation_persistence_ambiguous");
    expect(callable).toContain(
      'normalizeText(err?.paymentCheckoutOutcome).toLowerCase()\n      === "ambiguous"'
    );
    expect(callable).toContain("|| checkoutPreparationAmbiguous");
    expect(callable).toContain(
      "Stripe checkout preparation is uncertain. Retry the same approved payment request"
    );

    expect(preparationSource).toContain(
      "if (!isAmbiguousStripeProviderError(err)) throw err"
    );
    expect(preparationSource).toContain("post_create_provider_cleanup_ambiguous");
    expect(preparationSource).toContain("post_create_generation_cleanup_ambiguous");
    expect(preparationSource).toContain("annotatePaymentCheckoutOutcome");

    const cleanupStart = callable.indexOf("let checkoutCleanupIncomplete = false");
    const cleanupSource = callable.slice(cleanupStart);
    const preparedToExpired = cleanupSource.indexOf(
      "await markPreparedCheckoutExpiredIfUnchanged"
    );
    const expectedToAdvanced = cleanupSource.indexOf(
      "await advanceCheckoutGenerationIfUnchanged"
    );
    const authoritativeConfirmation = cleanupSource.indexOf(
      "await isCheckoutCleanupStateResolved"
    );
    const failureUnlock = cleanupSource.indexOf(
      "const outcome = buildApprovalExecutionOutcome"
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(preparedToExpired).toBeGreaterThan(-1);
    expect(expectedToAdvanced).toBeGreaterThan(preparedToExpired);
    expect(authoritativeConfirmation).toBeGreaterThan(expectedToAdvanced);
    expect(failureUnlock).toBeGreaterThan(authoritativeConfirmation);
    expect(cleanupSource.slice(preparedToExpired, expectedToAdvanced)).toContain(
      "if (!cleanupResolved)"
    );
    expect(cleanupSource.slice(expectedToAdvanced, authoritativeConfirmation)).toContain(
      "if (!cleanupResolved)"
    );
    expect(cleanupSource.slice(authoritativeConfirmation, failureUnlock)).toContain(
      "checkoutCleanupIncomplete = !cleanupResolved"
    );
  });

  test("replays a concurrent successful execution before any failure cleanup", () => {
    const callable = callableSource("sendPaymentRequestEmail", "getIntegrationSetupStatus");
    const executionRecheck = callable.indexOf(
      "const latestExecutionSnap = await executionRef.get()"
    );
    const successfulReplay = callable.indexOf('if (latestState === "succeeded")');
    const cleanup = callable.indexOf("await neutralizeRejectedStripeCheckout");

    expect(executionRecheck).toBeGreaterThan(-1);
    expect(successfulReplay).toBeGreaterThan(executionRecheck);
    expect(cleanup).toBeGreaterThan(successfulReplay);
    expect(callable.slice(successfulReplay, cleanup)).toContain("idempotent: true");
    expect(callable).toContain("&& !executionAlreadyFinalized");
    expect(callable).toContain("|| executionStateUncertain");
  });

  test("locks quote edits, reopen, and portal rotation while payment dispatch is unresolved", () => {
    const editStart = FUNCTIONS_INDEX_SOURCE.indexOf(
      "async function updateTrustedQuoteDraftInternal"
    );
    const editEnd = FUNCTIONS_INDEX_SOURCE.indexOf(
      "function quoteCreationFailure",
      editStart
    );
    const editSource = FUNCTIONS_INDEX_SOURCE.slice(editStart, editEnd);
    const reopenSource = callableSource("reopenQuote", "rotateQuotePortalKey");
    const rotationSource = callableSource(
      "rotateQuotePortalKey",
      "notifyOwnerNewQuote"
    );

    expect(editStart).toBeGreaterThan(-1);
    expect(editSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "editing the quote")'
    );
    expect(editSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      editSource.indexOf("tx.update(quoteRef")
    );

    expect(reopenSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "reopening the quote")'
    );
    expect(reopenSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      reopenSource.indexOf("buildQuoteReopenDocuments")
    );

    expect(rotationSource).toContain(
      'assertNoInProgressPaymentDispatch(quote, "rotating the portal link")'
    );
    expect(rotationSource.indexOf("assertNoInProgressPaymentDispatch")).toBeLessThan(
      rotationSource.indexOf("buildPortalRotationDocuments")
    );
  });

  test.each([
    ["operation", { operationId: "another-approval" }],
    ["actor", { actorUid: "another-admin" }],
    ["scope", { actionScopeDigest: "b".repeat(64) }],
    ["idempotency key", { idempotencyKey: "another-provider-key" }]
  ])("rejects resume with changed %s identity", (_label, changed) => {
    expect(() => planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: start(),
      ...identity,
      ...changed
    })).toThrowError(PaymentDispatchStateError);
  });

  test("fails closed on incomplete stored provider acceptance evidence", () => {
    expect(() => planPaymentDispatchResume({
      executionState: "in_progress",
      dispatch: {
        ...start(),
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "",
        providerAcceptedAtISO: LATER
      },
      ...identity
    })).toThrowError(/provider-accepted payment dispatch evidence is incomplete/i);
  });

  test("classifies existing quote-delivery ambiguity annotations for direct integration", () => {
    expect(classifyPaymentDispatchError(providerError("fetch failed", {
      quoteDeliveryOutcome: "ambiguous",
      quoteDeliveryReason: "provider_network_error"
    }))).toEqual({
      outcome: "ambiguous",
      reason: "provider_network_error",
      providerHttpStatus: 0
    });
  });
});
